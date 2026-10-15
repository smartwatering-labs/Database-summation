#!/usr/bin/env python3
"""ab 风格 HTTP 压测脚本（仅标准库，无需 pip）。

用法: python ab_bench.py [url] [concurrency] [requests]
默认: url=http://127.0.0.1:5000/  concurrency=50  requests=1000
输出格式对齐 ApacheBench (ab)。
"""
import sys
import time
import socket
import ssl
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse


def parse_url(url):
    p = urlparse(url)
    scheme = p.scheme or "http"
    host = p.hostname
    port = p.port or (443 if scheme == "https" else 80)
    path = (p.path or "/") + (("?" + p.query) if p.query else "")
    return scheme, host, port, path


def one_request(scheme, host, port, path):
    """返回 (connect_ms, ttfb_ms, total_ms, status, body_bytes, ok)"""
    start = time.perf_counter()
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(30)
    try:
        t0 = time.perf_counter()
        s.connect((host, port))
        connect_ms = (time.perf_counter() - t0) * 1000

        if scheme == "https":
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            s = ctx.wrap_socket(s, server_hostname=host)

        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "User-Agent: ApacheBench/2.3\r\n"
            "Accept: */*\r\n"
            "Connection: close\r\n\r\n"
        ).encode("latin-1")
        s.sendall(req)
        t_send = time.perf_counter()

        data = b""
        ttfb_ms = None
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            if ttfb_ms is None:
                ttfb_ms = (time.perf_counter() - t_send) * 1000
            data += chunk

        total_ms = (time.perf_counter() - start) * 1000
        if ttfb_ms is None:
            ttfb_ms = total_ms

        # 解析状态码与 body 大小
        status = 0
        body_bytes = 0
        parts = data.split(b"\r\n\r\n", 1)
        if parts:
            status_line = parts[0].split(b"\r\n", 1)[0]
            try:
                status = int(status_line.split(b" ")[1])
            except (IndexError, ValueError):
                status = 0
            if len(parts) > 1:
                body_bytes = len(parts[1])

        ok = 200 <= status < 400
        return connect_ms, ttfb_ms, total_ms, status, body_bytes, ok
    except Exception:
        total_ms = (time.perf_counter() - start) * 1000
        return 0.0, 0.0, total_ms, 0, 0, False
    finally:
        try:
            s.close()
        except Exception:
            pass


def percentile(sorted_vals, pct):
    if not sorted_vals:
        return 0.0
    idx = int(math.ceil(pct / 100.0 * len(sorted_vals))) - 1
    idx = max(0, min(idx, len(sorted_vals) - 1))
    return sorted_vals[idx]


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5000/"
    concurrency = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 1000

    scheme, host, port, path = parse_url(url)

    print(f"This is ApacheBench-style bench, stdlib python emulation")
    print(f"Benchmarking {host} (be patient)")
    print(f"Target: {scheme}://{host}:{port}{path}")
    print(f"Concurrency Level:      {concurrency}")
    print(f"Complete requests:      {n}")
    print()

    t_start = time.perf_counter()
    records = []
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = [ex.submit(one_request, scheme, host, port, path) for _ in range(n)]
        for f in as_completed(futures):
            records.append(f.result())
    taken = time.perf_counter() - t_start

    total_ms = [r[2] for r in records]
    connect_ms = [r[0] for r in records]
    proc_ms = [r[1] for r in records]
    statuses = [r[3] for r in records]
    bodies = [r[4] for r in records]

    complete = len(records)
    failed = sum(1 for r in records if not r[5])
    # 计入请求头开销的传输字节近似（请求约 60 字节 + 响应头按 200 字节估）
    total_transferred = sum(b + 200 for b in bodies) + complete * 60
    html_transferred = sum(bodies)

    rps = complete / taken
    tpr_mean = taken * 1000 * concurrency / complete
    tpr_across = taken * 1000 / complete
    rate_kbps = (total_transferred / taken) / 1024.0

    total_sorted = sorted(total_ms)
    connect_sorted = sorted(connect_ms)
    proc_sorted = sorted(proc_ms)

    print("Document Length:        {} bytes".format(html_transferred if html_transferred else 0))
    print()
    print("Concurrency Level:      {}".format(concurrency))
    print("Time taken for tests:   {:.3f} seconds".format(taken))
    print("Complete requests:      {}".format(complete))
    print("Failed requests:        {}".format(failed))
    if failed:
        from collections import Counter
        print("   (非 2xx/3xx 或连接失败)")
        c = Counter(s for s, ok in zip(statuses, [r[5] for r in records]) if not ok)
        for k, v in sorted(c.items()):
            print("   status {}: {}".format(k, v))
    print("Total transferred:      {} bytes".format(total_transferred))
    print("HTML transferred:       {} bytes".format(html_transferred))
    print("Requests per second:    {:.2f} [#/sec] (mean)".format(rps))
    print("Time per request:       {:.3f} [ms] (mean)".format(tpr_mean))
    print("Time per request:       {:.3f} [ms] (mean, across all concurrent requests)".format(tpr_across))
    print("Transfer rate:          {:.2f} [Kbytes/sec] received".format(rate_kbps))
    print()
    print("Connection Times (ms)")
    print("              min  mean[+/-sd] median   max")
    def row(name, vals):
        if not vals:
            return
        mn = min(vals)
        mx = max(vals)
        mean = sum(vals) / len(vals)
        var = sum((x - mean) ** 2 for x in vals) / len(vals)
        sd = math.sqrt(var)
        med = percentile(sorted(vals), 50)
        print("{:>9} {:7.1f} {:7.1f} {:6.1f} {:7.1f} {:7.1f}".format(name, mn, mean, sd, med, mx))
    row("Connect:", connect_ms)
    row("Processing:", proc_ms)
    row("Total:", total_ms)
    print()
    print("Percentage of the requests served within a certain time (ms)")
    for pct in (50, 66, 75, 80, 90, 95, 98, 99, 100):
        print("  {:>2}%  {:8.1f}".format(pct, percentile(total_sorted, pct)))


if __name__ == "__main__":
    main()
