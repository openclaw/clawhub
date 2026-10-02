FROM node:22.18.0-bookworm@sha256:3266bc9e8bee1acc8a77386eefaf574987d2729b8c5ec35b0dbd6ddbc40b0ce2

ARG ENDORCTL_SHA256
ARG TYPESCRIPT_VERSION=6.0.3

RUN apt-get update \
    && apt-get install --yes --no-install-recommends iptables util-linux \
    && rm -rf /var/lib/apt/lists/*

# Supply the reviewed Linux endorctl binary as "endorctl" in the build context.
COPY endorctl /usr/local/bin/endorctl
COPY egress-guard.sh /usr/local/bin/clawhub-endor-egress-guard
COPY entrypoint.sh /usr/local/bin/clawhub-endor-entrypoint
RUN chmod 755 /usr/local/bin/clawhub-endor-egress-guard /usr/local/bin/clawhub-endor-entrypoint
RUN test -n "$ENDORCTL_SHA256" \
    && printf '%s  %s\n' "$ENDORCTL_SHA256" /usr/local/bin/endorctl | sha256sum --check - \
    && chmod 755 /usr/local/bin/endorctl \
    && npm install --global --ignore-scripts --no-audit --no-fund npm@11.19.1 \
    && npm install --global --ignore-scripts --no-audit --no-fund "typescript@${TYPESCRIPT_VERSION}"

ENV NPM_CONFIG_IGNORE_SCRIPTS=true \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    COREPACK_ENABLE_PROJECT_SPEC=0

COPY scan.sh /usr/local/bin/clawhub-endor-scan
RUN chmod 755 /usr/local/bin/clawhub-endor-scan

WORKDIR /workspace
