"""Supply a per-device key over local USB; write the owner credential locally."""
import argparse
import json
import re
import secrets
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', required=True, help='Explicit USB serial port, e.g. COM5')
    parser.add_argument('--device-id', required=True)
    parser.add_argument('--credential', type=Path, help='New local JSON file; existing files are preserved')
    parser.add_argument('--role', choices=('owner', 'operator', 'viewer'), default='owner')
    parser.add_argument('--revoke', action='store_true', help='Revoke operator/viewer credential over local USB')
    parser.add_argument('--rotate', action='store_true', help='Replace the device existing key; prior credential will stop working')
    args = parser.parse_args()
    if not re.fullmatch(r'C3-[0-9a-f]{12}', args.device_id):
        parser.error('device-id must match the ID reported by the connected ESP32-C3')
    if args.revoke and args.role == 'owner':
        parser.error('replace the owner credential with --rotate; owner revocation is not available')
    if not args.revoke and args.credential is None:
        parser.error('--credential is required when supplying a role')
    if args.credential and args.credential.exists() and not args.revoke:
        parser.error('credential file already exists; select a new file')
    try:
        import serial
    except ImportError:
        parser.error('install pyserial in this Python environment first')
    with serial.Serial(args.port, 115200, timeout=.25, write_timeout=3) as connection:
        time.sleep(.5)
        connection.reset_input_buffer()
        connection.write(b'IDENTITY\n')
        deadline = time.monotonic() + 5
        identity = None
        while time.monotonic() < deadline:
            line = connection.readline().decode('utf-8', errors='replace').strip()
            if line.startswith('IDENTITY '):
                identity = line.split()
                break
            if line == 'DISPLAY_REQUIRED':
                parser.error('switch the device to DISPLAY before key supply')
        if not identity or len(identity) != 3 or identity[1] != args.device_id:
            parser.error('USB device identity did not match; key supply stopped')
        if args.role != 'owner' and identity[2] != 'hmac-sha256-v1':
            parser.error('supply the owner credential before adding or revoking roles')
        if args.role == 'owner':
            exists = identity[2] == 'hmac-sha256-v1'
        else:
            connection.write(('AUTHSTATUS ' + args.role + '\n').encode('ascii'))
            deadline = time.monotonic() + 5
            status = None
            while time.monotonic() < deadline:
                response = connection.readline().decode('utf-8', errors='replace').strip()
                if response in (f'AUTHSTATUS {args.role} 0', f'AUTHSTATUS {args.role} 1'):
                    status = response.endswith('1')
                    break
            if status is None:
                parser.error('device did not report role status; verify that the current firmware supports roles')
            exists = status
        if args.revoke:
            if not exists:
                parser.error('role credential is already absent')
            connection.write(('AUTHREVOKE ' + args.role + '\n').encode('ascii'))
            expected_response = 'AUTH_REVOKED'
        else:
            if exists and not args.rotate:
                parser.error('role credential exists; use --rotate and a new output file to replace it')
            credential = {'deviceId': args.device_id, 'role': args.role, 'secret': secrets.token_hex(32)}
            args.credential.parent.mkdir(parents=True, exist_ok=True)
            with args.credential.open('x', encoding='utf-8') as output:
                json.dump(credential, output, ensure_ascii=False, indent=2)
                output.write('\n')
            command = 'AUTH ' + (args.role + ' ' if args.role != 'owner' else '') + credential['secret'] + '\n'
            connection.write(command.encode('ascii'))
            expected_response = 'AUTH_PROVISIONED'
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            response = connection.readline().decode('utf-8', errors='replace').strip()
            if response == expected_response:
                if args.revoke:
                    print(f'{args.role} credential revoked on {args.device_id}')
                else:
                    print(f'{args.role} credential supplied to {args.device_id}; local file: {args.credential.resolve()}')
                return
            if response in ('AUTH_INVALID', 'AUTH_SAVE_FAILED', 'DISPLAY_REQUIRED'):
                raise RuntimeError(f'Key supply failed: {response}. Keep the local credential for reconciliation.')
        raise RuntimeError('Device acknowledgement was not received. Keep the credential and reconnect to verify identity.')


if __name__ == '__main__':
    main()
