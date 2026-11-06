#!/bin/sh
set -eu
image=${1:?Supply the Endor scanner image to check}
docker run --rm --network none "$image" sh -c '
  test -x /usr/local/bin/clawhub-endor-scan
  test -x /usr/local/bin/clawhub-endor-entrypoint
  test -x /usr/local/bin/clawhub-endor-egress-guard
'
docker run --rm --network bridge --dns 1.1.1.1 --dns 8.8.8.8 \
  --cap-drop ALL --cap-add NET_ADMIN \
  --security-opt no-new-privileges:true \
  "$image" sh -c '
    /usr/local/bin/clawhub-endor-egress-guard
    iptables -C OUTPUT -d 169.254.0.0/16 -j REJECT
    iptables -C OUTPUT -d 172.16.0.0/12 -j REJECT
    ip6tables -C OUTPUT -d fc00::/7 -j REJECT
    ip6tables -C OUTPUT -d fe80::/10 -j REJECT
  '
docker run --rm --network bridge --dns 1.1.1.1 --dns 8.8.8.8 --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,exec \
  --cap-drop ALL --cap-add NET_ADMIN \
  --cap-add SETUID --cap-add SETGID --cap-add SETPCAP --cap-add CHOWN \
  --security-opt no-new-privileges:true \
  --entrypoint /usr/local/bin/clawhub-endor-entrypoint \
  "$image" sh -c '
    test "$(id -u)" -eq 1000 && test -w /tmp && test ! -w /
    probe=$(mktemp)
    printf "#!/bin/sh\nexit 0\n" > "$probe"
    chmod 700 "$probe"
    "$probe"
  '
