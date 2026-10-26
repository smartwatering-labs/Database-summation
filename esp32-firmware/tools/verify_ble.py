"""Read-only BLE acceptance: verify identity, signed replies and negotiated chunks.

Requires bleak. Uses an existing owner credential; never provisions, formats,
changes configuration, switches mode or activates an actuator.
"""
import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import time
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path

WRITE_UUID = '2d26a7cc-1d45-4eae-9280-2a97346fd002'
NOTIFY_UUID = '2d26a7cc-1d45-4eae-9280-2a97346fd003'
PROTOCOL = 'SWS-BLE'
VERSION = '1.0'


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


class Probe:
    def __init__(self, client, credential, report, timeout):
        self.client, self.report, self.timeout = client, report, timeout
        self.device_id = credential['deviceId']
        self.secret = bytes.fromhex(credential['secret'])
        self.nonce, self.sequence, self.chunk = None, 0, 20
        self.buffer, self.parts, self.waiter, self.request_id = bytearray(), {}, None, None

    def mac(self, text):
        return hmac.new(self.secret, text.encode('utf-8'), hashlib.sha256).hexdigest()

    def notification(self, _sender, data):
        try:
            self.report['maxNotificationBytes'] = max(self.report['maxNotificationBytes'], len(data))
            self.buffer.extend(data)
            if len(self.buffer) > 32768:
                raise ValueError('BLE receive buffer exceeded')
            while b'\n' in self.buffer:
                line, _, rest = self.buffer.partition(b'\n')
                self.buffer = bytearray(rest)
                if not line.strip():
                    continue
                frame = json.loads(line)
                if frame.get('id') != self.request_id:
                    continue
                total, index = frame['total'], frame['index']
                if not isinstance(total, int) or not isinstance(index, int) or not 0 <= index < total <= 70:
                    raise ValueError('Invalid BLE frame bounds')
                part = base64.b64decode(frame['data'], validate=True)
                key = (total, frame['checksum'])
                if self.parts and key not in self.parts:
                    raise ValueError('Conflicting BLE frame metadata')
                parts = self.parts.setdefault(key, {})
                if index in parts and parts[index] != part:
                    raise ValueError('Conflicting BLE duplicate')
                parts[index] = part
                if sum(map(len, parts.values())) > 8192:
                    raise ValueError('BLE reply exceeded message capacity')
                if len(parts) != total:
                    continue
                raw = b''.join(parts[i] for i in range(total))
                self.parts.clear()
                if f'{zlib.crc32(raw):08x}' != frame['checksum']:
                    raise ValueError('BLE reply checksum mismatch')
                reply = json.loads(raw)
                if self.nonce is not None:
                    envelope = reply.get('payload', {})
                    body = envelope.get('body', '')
                    expected = self.mac(f'response|{self.device_id}|{self.nonce}|{self.sequence}|{body}')
                    if (reply.get('status') != 'secured' or envelope.get('sequence') != self.sequence
                            or not hmac.compare_digest(expected, str(envelope.get('mac', '')))):
                        raise ValueError('BLE reply signature mismatch')
                    reply = json.loads(base64.b64decode(body, validate=True))
                if (reply.get('id') != self.request_id or reply.get('protocol') != PROTOCOL
                        or reply.get('protocolVersion') != VERSION):
                    raise ValueError('BLE reply identity or protocol mismatch')
                if reply.get('status') == 'progress':
                    continue
                if self.waiter and not self.waiter.done():
                    self.waiter.set_result(reply)
        except Exception:
            # Device bytes and credential material stay out of exception logs.
            if self.waiter and not self.waiter.done():
                self.waiter.set_exception(ValueError('BLE frame or signed reply validation failed'))

    async def request(self, action, payload=None):
        self.request_id = uuid.uuid4().hex
        self.buffer.clear()
        self.parts.clear()
        message = dict(id=self.request_id, protocol=PROTOCOL, protocolVersion=VERSION,
                       action=action, payload=payload or {})
        if self.nonce is not None:
            self.sequence += 1
            body = base64.b64encode(encode(message)).decode('ascii')
            message = dict(id=self.request_id, protocol=PROTOCOL, protocolVersion=VERSION,
                           action='secured', payload=dict(sequence=self.sequence, body=body,
                           mac=self.mac(f'request|{self.device_id}|{self.nonce}|{self.sequence}|{body}')))
        raw = encode(message)
        if len(raw) > 8192:
            raise ValueError('Diagnostic request exceeded device capacity')
        self.waiter = asyncio.get_running_loop().create_future()
        started = time.monotonic()
        writes = 0
        try:
            async with asyncio.timeout(self.timeout):
                total = (len(raw) + 119) // 120
                for index in range(total):
                    frame = encode(dict(id=self.request_id, index=index, total=total,
                                   checksum=f'{zlib.crc32(raw):08x}',
                                   data=base64.b64encode(raw[index*120:(index+1)*120]).decode('ascii'))) + b'\n'
                    for offset in range(0, len(frame), self.chunk):
                        chunk = frame[offset:offset+self.chunk]
                        await self.client.write_gatt_char(WRITE_UUID, chunk, response=True)
                        writes += 1
                        self.report['maxWriteBytes'] = max(self.report['maxWriteBytes'], len(chunk))
                reply = await self.waiter
            result = reply.get('status', 'invalid')
            if result != 'ok':
                raise ValueError('Device rejected read-only diagnostic request')
            return reply.get('payload', {})
        finally:
            self.report['operations'].append(dict(action=action, signed=self.nonce is not None,
                seconds=round(time.monotonic()-started, 3), writes=writes,
                status=locals().get('result', 'incomplete')))
            if not self.waiter.done():
                self.waiter.cancel()
            elif not self.waiter.cancelled():
                self.waiter.exception()


async def run(args, report):
    from bleak import BleakClient, BleakScanner
    if args.credential.stat().st_size > 4096:
        raise ValueError('Credential file exceeds 4 KB')
    credential = json.loads(args.credential.read_text(encoding='utf-8-sig'))
    if (not isinstance(credential.get('deviceId'), str) or not credential['deviceId']
            or not isinstance(credential.get('secret'), str) or len(credential['secret']) != 64):
        raise ValueError('Invalid owner credential')
    bytes.fromhex(credential['secret'])
    report['deviceId'] = credential['deviceId']
    device = await BleakScanner.find_device_by_address(args.address, timeout=8)
    if device is None:
        raise ValueError('Target BLE device was not found; check power and browser connection')
    async with BleakClient(device, pair=True, winrt={'use_cached_services': False}) as client:
        probe = Probe(client, credential, report, args.timeout)
        await client.start_notify(NOTIFY_UUID, probe.notification)
        handshake = await probe.request('handshake')
        if (handshake.get('deviceId') != credential['deviceId'] or handshake.get('model') != 'ESP32-C3'
                or handshake.get('authProfile') != 'hmac-sha256-v1'
                or handshake.get('protocol') != PROTOCOL or handshake.get('protocolVersion') != VERSION):
            raise ValueError('Handshake device identity or authentication profile mismatch')
        nonce = handshake.get('nonce')
        if not isinstance(nonce, str) or not 8 <= len(nonce) <= 256:
            raise ValueError('Invalid handshake challenge')
        binding = credential['deviceId'] + '|' + nonce
        role = credential.get('role', 'owner')
        if role not in ('owner', 'operator', 'viewer'):
            raise ValueError('Invalid credential role')
        proof = handshake.get('deviceProof') if role == 'owner' else handshake.get('deviceProofs', {}).get(role)
        if not hmac.compare_digest(probe.mac('device|' + binding), str(proof)):
            raise ValueError('Device proof verification failed')
        chunk = handshake.get('transport', {}).get('writeChunkBytes', 20)
        if type(chunk) is not int or not 20 <= chunk <= 244:
            raise ValueError('Invalid negotiated write capacity')
        probe.chunk = chunk
        client_proof = probe.mac('client|' + (role + '|' if role != 'owner' else '') + binding)
        auth_payload = {'auth': client_proof, **({'role': role} if role != 'owner' else {})}
        if (await probe.request('authenticate', auth_payload)).get('authenticated') is not True:
            raise ValueError('Device did not confirm owner authentication')
        probe.nonce = nonce
        report.update(authProfile='hmac-sha256-v1', authorizationRole=role, deviceProofVerified=True,
                      negotiatedWriteChunkBytes=chunk, mtu=client.mtu_size,
                      firmwareVersion=handshake.get('fwVersion'))
        status = await probe.request('status')
        config = (await probe.request('getConfiguration')).get('config')
        events = await probe.request('events', {'limit': 24})
        history = await probe.request('history', {'range': '7d', 'limit': 24})
        final_status = await probe.request('status')
        if any(value.get('deviceId') != credential['deviceId'] for value in (status, events, history, final_status)):
            raise ValueError('Readback device identity mismatch')
        if (status.get('configRevision') != final_status.get('configRevision')
                or (config and config.get('revision') != status.get('configRevision'))):
            raise ValueError('Configuration revision changed during read-only verification')
        report['configuration'] = None if not config else {key: config.get(key) for key in
            ('plant', 'revision', 'configVersion', 'targetDeviceId', 'params')}
        report['eventRecords'] = len(events.get('records', []))
        report['historyRecords'] = len(history.get('records', []))
        report['status'] = {key: final_status.get(key) for key in ('configRevision', 'mode',
            'logStorageReady', 'timeQuality', 'controlState', 'controlInhibition')}
        report['passed'] = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--address', required=True, help='Exact target BLE address')
    parser.add_argument('--credential', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path, help='New diagnostic JSON file')
    parser.add_argument('--timeout', type=float, default=20)
    args = parser.parse_args()
    if args.output.exists() or args.output.resolve() == args.credential.resolve():
        parser.error('Choose a new output path; existing files are preserved')
    if not 1 <= args.timeout <= 60:
        parser.error('timeout must be between 1 and 60 seconds')
    report = dict(checkedAt=datetime.now(timezone.utc).isoformat(), passed=False, operations=[],
                  maxWriteBytes=0, maxNotificationBytes=0)
    try:
        asyncio.run(run(args, report))
    except Exception as error:
        report['errorType'] = type(error).__name__
        print('BLE verification incomplete; check device power, access and connection. See diagnostic JSON.')
    finally:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as output:
            json.dump(report, output, ensure_ascii=False, indent=2)
            output.write('\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()
