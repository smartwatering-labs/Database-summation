"""Supply a measured calibration record to an explicitly selected local board."""
import argparse
import json
import time
from pathlib import Path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',required=True)
    parser.add_argument('--device-id',required=True)
    parser.add_argument('--file',required=True,type=Path)
    args=parser.parse_args()
    record=json.loads(args.file.read_text(encoding='utf-8-sig'))
    if record.get('verified') is not True or not record.get('measuredAt'):
        parser.error('record must include measuredAt and verified=true after physical measurement')
    raw=json.dumps(record,ensure_ascii=False,separators=(',',':'))
    if len(raw.encode('utf-8'))>1800:
        parser.error('calibration record exceeds the serial command capacity')
    try:
        import serial
    except ImportError:
        parser.error('install pyserial in this Python environment first')
    with serial.Serial(args.port,115200,timeout=.25,write_timeout=3) as connection:
        time.sleep(.5);connection.reset_input_buffer();connection.write(b'IDENTITY\n')
        deadline=time.monotonic()+5;matched=False
        while time.monotonic()<deadline:
            line=connection.readline().decode('utf-8',errors='replace').strip()
            if line.startswith('IDENTITY '):
                matched=line.split()[1]==args.device_id
                break
        if not matched:
            parser.error('USB device identity did not match or DISPLAY mode was not available')
        connection.write(('CAL '+raw+'\n').encode('utf-8'));deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            line=connection.readline().decode('utf-8',errors='replace').strip()
            if line=='CAL_SAVED':
                print(f'Calibration saved and read back on {args.device_id}.');return
            if line in ('CAL_INVALID','CAL_SAVE_FAILED','DISPLAY_REQUIRED'):
                raise RuntimeError(line)
        raise RuntimeError('Calibration acknowledgement was not received; verify the device before enabling LONGRUN.')


if __name__=='__main__':
    main()
