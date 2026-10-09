"""Unit tests for the measurement helpers; no Docker or network mocking."""
import unittest
import socket
import tempfile
import threading

from boot import api, percentile, require_status


class MeasurementTests(unittest.TestCase):
    def test_p95_is_nearest_rank_and_includes_the_slowest_of_ten(self):
        self.assertEqual(percentile([9, 2, 4, 1, 5, 3, 8, 6, 10, 7], 95), 10)
        self.assertEqual(percentile(list(range(1, 31)), 95), 29)

    def test_rejects_empty_measurements(self):
        with self.assertRaises(ValueError):
            percentile([], 95)

    def test_api_errors_cannot_be_counted_as_successful_boots(self):
        require_status(204, b"")
        with self.assertRaises(RuntimeError):
            require_status(400, b'{"fault_message":"boot rejected"}')

    def test_unix_api_reaches_a_real_socket(self):
        with tempfile.TemporaryDirectory() as directory:
            path = directory + "/api.sock"
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(path)
                listener.listen(1)
                requests = []

                def serve():
                    connection, _ = listener.accept()
                    with connection:
                        request = b""
                        while b"\r\n\r\n" not in request:
                            request += connection.recv(8192)
                        header, body = request.split(b"\r\n\r\n", 1)
                        size = int(next(line.split(b":", 1)[1] for line in header.split(b"\r\n") if line.lower().startswith(b"content-length:")))
                        while len(body) < size:
                            body += connection.recv(8192)
                        requests.append(header + b"\r\n\r\n" + body)
                        connection.sendall(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")

                server = threading.Thread(target=serve)
                server.start()
                api("/actions", {"action_type": "InstanceStart"}, socket_path=path)
                server.join(timeout=2)
                self.assertFalse(server.is_alive())
                self.assertTrue(requests[0].startswith(b"PUT /actions HTTP/1.1"))


if __name__ == "__main__":
    unittest.main()
