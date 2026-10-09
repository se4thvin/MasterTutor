#!/usr/bin/env python3
"""Bind before golden; accept a bounded start line without writing it to disk."""
import re
import socket


def parse_start(line):
    if len(line) > 8192 or not re.fullmatch(rb"start ([0-9]{13})\n", line):
        raise ValueError("invalid start line")
    return int(line[6:-1])


def main():
    with socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM) as listener:
        listener.bind((socket.VMADDR_CID_ANY, 51))
        listener.listen(1)
        with socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM) as golden:
            golden.connect((2, 1025))
            golden.sendall(b"golden\n")
        connection, _ = listener.accept()
        with connection, connection.makefile("rb") as stream:
            epoch = parse_start(stream.readline(8193))
        print(epoch)


if __name__ == "__main__":
    main()
