FROM mt-vm-p0-restore:local
LABEL mt-vm-p0="1"
RUN apt-get update && apt-get install -y --no-install-recommends nftables && rm -rf /var/lib/apt/lists/*
COPY desktop.nft entry.sh live.py /opt/spike/net/
ENTRYPOINT ["/bin/bash", "/opt/spike/net/entry.sh"]
