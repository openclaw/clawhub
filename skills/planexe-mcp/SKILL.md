---
name: planexe-mcp
description: Connect OpenClaw to PlanExe via MCP for structured planning. Supports cloud (mcp.planexe.org with Stripe credits), remote Docker, or local Docker on the same machine as OpenClaw.
---

# PlanExe MCP Integration

This skill enables OpenClaw to connect to **PlanExe** via the Model Context Protocol (MCP), providing structured planning and task execution capabilities. Three deployment scenarios are supported.

## Scenario A: Cloud via mcp.planexe.org

**Setup:**
1. Create a PlanExe account at [home.planexe.org](https://home.planexe.org)
2. Set up Stripe payment to fund credits
3. Generate an API token from your account dashboard
4. Configure OpenClaw with the token to connect to `mcp.planexe.org`

**Configuration:**
```bash
export PLANEXE_API_TOKEN="your-token-here"
export PLANEXE_MCP_HOST="mcp.planexe.org"
```

**Billing:**
- Credits purchased via Stripe at home.planexe.org
- Pay-as-you-go model
- Credits consumed per planning operation

**Best for:** Teams with cloud-first infrastructure, managed service preference

---

## Scenario B: Remote Docker on a Separate Machine

**Setup:**
1. Deploy PlanExe Docker container on a remote machine (Linux server, VM, etc.)
2. Expose MCP endpoint over network (secured with TLS recommended)
3. Configure firewall rules to allow OpenClaw's IP
4. Store remote host credentials securely

**Configuration:**
```bash
export PLANEXE_MCP_HOST="remote-server.example.com:9000"
export PLANEXE_MCP_PORT="9000"
export PLANEXE_AUTH_TOKEN="remote-token"
export PLANEXE_TLS_CERT="/path/to/cert.pem"  # Optional, for security
```

**Deployment:**
```bash
# On remote machine
docker run -d -p 9000:9000 \
  -e PLANEXE_TOKEN="remote-token" \
  planexe:latest
```

**Best for:** Distributed teams, load balancing across machines, keeping compute separate from OpenClaw host

---

## Scenario C: Local Docker on the Same Machine

**Setup:**
1. Install Docker on the OpenClaw host machine
2. Pull and run PlanExe container locally
3. OpenClaw connects to localhost via docker network bridge
4. No external dependencies, zero latency

**Configuration:**
```bash
export PLANEXE_MCP_HOST="localhost"
export PLANEXE_MCP_PORT="9000"
export PLANEXE_DOCKER_NETWORK="openclaw-net"
```

**Deployment:**
```bash
# Create docker network (if not exists)
docker network create openclaw-net

# Run PlanExe container
docker run -d \
  --name planexe-mcp \
  --network openclaw-net \
  -p 9000:9000 \
  planexe:latest
```

**Best for:** Local development, single-machine setups, maximum performance, offline capability

---

## Common Connection Steps (All Scenarios)

1. **Add to OpenClaw configuration:**
   - Update `.openclaw/config.json` or environment variables
   - Set `planexe-mcp` as an available MCP provider

2. **Test connection:**
   ```bash
   openclaw test-mcp planexe
   ```

3. **Verify capabilities:**
   - Check available planning tools
   - Confirm token/auth is valid
   - Test a simple planning request

4. **Enable in workflows:**
   - Add `@planexe` directives in skill definitions
   - Use in OpenClaw agents for structured task planning

## See Also

- [PlanExe Documentation](https://docs.planexe.org)
- [MCP Specification](https://modelcontextprotocol.io)
- [OpenClaw MCP Integration Guide](https://openclaw.dev/docs/mcp)
