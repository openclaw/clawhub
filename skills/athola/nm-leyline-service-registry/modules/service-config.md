---
name: service-config
description: Service configuration patterns and options
estimated_tokens: 400
---

# Service Configuration

## Configuration Schema

### Full Configuration
```python
@dataclass
class ServiceConfig:
    # Identity
    name: str
    display_name: str = ""

    # Execution
    command: str  # CLI command or endpoint
    command_template: str = "{command} -p {prompt}"

    # Authentication
    auth_method: str  # api_key, oauth, token, none
    auth_env_var: str = ""
    auth_check_cmd: str = ""  # Command to verify auth

    # Quotas
    quota_limits: dict = field(default_factory=dict)
    # Example: {"rpm": 60, "tpm": 100000, "daily": 1000}

    # Models
    models: list[str] = field(default_factory=list)
    default_model: str = ""

    # Capabilities
    max_context: int = 100000
    supports_files: bool = True
    supports_streaming: bool = False

    # Health
    health_check_cmd: str = ""
    timeout_seconds: int = 60
```

## Service Examples

### Gemini Service
```python
GEMINI_CONFIG = ServiceConfig(
    name="gemini",
    display_name="Google Gemini",
    command="gemini",
    command_template="gemini -p '{prompt}' {files}",
    auth_method="api_key",
    auth_env_var="GEMINI_API_KEY",
    auth_check_cmd="gemini auth status",
    quota_limits={
        "rpm": 60,
        "tpm": 1000000,
        "daily": 1000
    },
    models=["gemini-2.5-flash-exp", "gemini-2.5-pro-exp"],
    default_model="gemini-2.5-flash-exp",
    max_context=1000000,
    health_check_cmd="gemini 'ping'",
    timeout_seconds=60
)
```

### Qwen Service
```python
QWEN_CONFIG = ServiceConfig(
    name="qwen",
    display_name="Alibaba Qwen",
    command="qwen",
    command_template="qwen -p '{prompt}' {files}",
    auth_method="api_key",
    auth_env_var="QWEN_API_KEY",
    quota_limits={
        "rpm": 120,
        "tpm": 2000000,
        "daily": 2000
    },
    models=["qwen-turbo", "qwen-max"],
    default_model="qwen-turbo",
    max_context=100000
)
```

## Configuration Loading

### From YAML
```yaml
# ~/.claude/leyline/services.yaml
services:
  gemini:
    command: gemini
    auth_method: api_key
    auth_env_var: GEMINI_API_KEY
    quota_limits:
      rpm: 60
      daily: 1000
```

### From Environment
```python
def load_from_env(service_name: str) -> ServiceConfig:
    prefix = service_name.upper()
    return ServiceConfig(
        name=service_name,
        command=os.getenv(f"{prefix}_COMMAND", service_name),
        auth_env_var=f"{prefix}_API_KEY",
        # ... other fields
    )
```
