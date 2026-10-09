#!/usr/bin/env python3
"""Bind before golden; accept a bounded start line without writing it to disk."""
import base64
import json
import shlex
import re
import socket


def parse_start(line):
    if len(line) > 8192 or not re.fullmatch(rb"start ([0-9]{13})\n", line):
        raise ValueError("invalid start line")
    return int(line[6:-1])


def parse_settings(line):
    if len(line) > 8192:
        raise ValueError("start line too long")
    match = re.fullmatch(rb"start ([0-9]{13})(?: ([A-Za-z0-9+/=]+))?\n", line)
    if not match:
        raise ValueError("invalid start settings")
    password = None
    if match[2]:
        data = json.loads(base64.b64decode(match[2], validate=True))
        if not isinstance(data, dict) or set(data) != {"password"} or not isinstance(data["password"], str) or not re.fullmatch(r"[a-f0-9]{48}", data["password"]):
            raise ValueError("invalid settings fields")
        password = data["password"]
    return int(match[1]), password


def main():
    with socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM) as listener:
        listener.bind((socket.VMADDR_CID_ANY, 51))
        listener.listen(1)
        with socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM) as golden:
            golden.connect((2, 1025))
            golden.sendall(b"golden\n")
        connection, _ = listener.accept()
        with connection, connection.makefile("rb") as stream:
            epoch, password = parse_settings(stream.readline(8193))
        print("epoch=" + str(epoch))
        users = []
        if password:
            profile = {key: True for key in ["is_admin", "can_login", "can_connect", "can_watch", "can_host", "can_share_media", "can_access_clipboard"]}
            profile.update(name="agent", sends_inactive_cursor=False, can_see_inactive_cursors=False)
            users = [{"username": "agent", "password": password, "profile": profile}]
        print("export NEKO_MEMBER_OBJECT_USERS=" + shlex.quote(json.dumps(users)))


if __name__ == "__main__":
    main()
