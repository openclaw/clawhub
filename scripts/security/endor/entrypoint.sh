#!/bin/sh
set -eu

/usr/local/bin/clawhub-endor-egress-guard
mkdir -p /tmp/endor-home
chmod 700 /tmp/endor-home
chown node:node /tmp/endor-home

exec setpriv \
	--bounding-set=-all \
	--inh-caps=-all \
	--ambient-caps=-all \
	--reuid=node \
	--regid=node \
	--clear-groups \
	env HOME=/tmp/endor-home "$@"
