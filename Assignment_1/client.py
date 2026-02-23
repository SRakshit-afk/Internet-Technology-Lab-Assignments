import sys
import socket


def main():
    if len(sys.argv) < 3:
        print("Usage: ./client <hostname> <port> <commands...>")
        print("Example: python client.py localhost 5555 put city Kolkata get city")
        return

    hostname = sys.argv[1]
    port = int(sys.argv[2])

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect((hostname, port))

        server_reader = sock.makefile("r")

        i = 3
        args = sys.argv

        while i < len(args):
            cmd = args[i]

            if cmd.lower() == "put":
                if i + 2 < len(args):
                    key = args[i + 1]
                    val = args[i + 2]

                    msg = f"put {key} {val}\n"
                    sock.sendall(msg.encode())

                    server_reader.readline() 
                    # server responds with "OK" or "ERROR"

                    i += 3 
                else:
                    print("Invalid PUT arguments", file=sys.stderr)
                    break

            elif cmd.lower() == "get":
                if i + 1 < len(args):
                    key = args[i + 1]

                    msg = f"get {key}\n"
                    sock.sendall(msg.encode())

                    response = server_reader.readline().strip()
                    print(response)

                    i += 2  # Skip get, key
                else:
                    print("Invalid GET arguments", file=sys.stderr)
                    break

            elif cmd.lower() == "auth":
                if i + 1 < len(args):
                    msg = f"auth {args[i + 1]}\n"
                    sock.sendall(msg.encode())

                    response = server_reader.readline().strip()
                    print(response)
                    i += 2
            else:
                i += 1

        sock.close()

    except ConnectionRefusedError:
        print(f"Error: Could not connect to server at {hostname}:{port}") 
        # Server not running or wrong hostname/port
    except Exception as e:
        print(f"An error occurred: {e}")
        # Catch-all for any other exceptions that may occur


if __name__ == "__main__":
    main()

# python client.py localhost 4000 put city Kolkata put country India get country get city get Institute
# python client.py 127.0.0.2 4000 put secret Hidden
# python client.py 127.0.0.2 4000 auth admin123 get 127.0.0.1:secret
# python client.py 192.168.147.186 4000 auth admin123 get 192.168.147.103:city