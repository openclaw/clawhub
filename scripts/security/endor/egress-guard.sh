#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
	echo "Endor egress guard must run as root" >&2
	exit 1
fi

for subnet in \
	0.0.0.0/8 \
	10.0.0.0/8 \
	100.64.0.0/10 \
	169.254.0.0/16 \
	172.16.0.0/12 \
	192.0.0.0/24 \
	192.0.2.0/24 \
	192.88.99.0/24 \
	192.168.0.0/16 \
	198.18.0.0/15 \
	198.51.100.0/24 \
	203.0.113.0/24 \
	224.0.0.0/4 \
	240.0.0.0/4
do
	iptables -w -I OUTPUT 1 -d "$subnet" -j REJECT
done

for subnet in \
	::/128 \
	::ffff:0:0/96 \
	64:ff9b::/96 \
	64:ff9b:1::/48 \
	100::/64 \
	2001::/23 \
	2001:db8::/32 \
	2002::/16 \
	3fff::/20 \
	fc00::/7 \
	fe80::/10 \
	ff00::/8
do
	ip6tables -w -I OUTPUT 1 -d "$subnet" -j REJECT
done
