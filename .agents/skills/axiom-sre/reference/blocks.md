# Block Kit Reference

Rich message formatting using Slack's Block Kit.

## Block Types

### Header
```json
{"type":"header","text":{"type":"plain_text","text":"Title","emoji":true}}
```

### Section
```json
{"type":"section","text":{"type":"mrkdwn","text":"*Bold* _italic_ `code`"}}
```

With accessory (button, image, etc.):
```json
{
  "type":"section",
  "text":{"type":"mrkdwn","text":"Click the button"},
  "accessory":{
    "type":"button",
    "text":{"type":"plain_text","text":"Click"},
    "action_id":"button_click",
    "url":"https://example.com"
  }
}
```

With fields (2-column layout):
```json
{
  "type":"section",
  "fields":[
    {"type":"mrkdwn","text":"*Field 1*\nValue 1"},
    {"type":"mrkdwn","text":"*Field 2*\nValue 2"}
  ]
}
```

### Divider
```json
{"type":"divider"}
```

### Image
```json
{
  "type":"image",
  "image_url":"https://example.com/image.png",
  "alt_text":"Description"
}
```

### Context (small text/images)
```json
{
  "type":"context",
  "elements":[
    {"type":"mrkdwn","text":"Posted by <@U1234>"},
    {"type":"image","image_url":"https://example.com/icon.png","alt_text":"icon"}
  ]
}
```

### Actions (buttons, selects, etc.)
```json
{
  "type":"actions",
  "elements":[
    {
      "type":"button",
      "text":{"type":"plain_text","text":"Approve"},
      "style":"primary",
      "action_id":"approve"
    },
    {
      "type":"button",
      "text":{"type":"plain_text","text":"Reject"},
      "style":"danger",
      "action_id":"reject"
    }
  ]
}
```

### Input (for modals/workflows)
```json
{
  "type":"input",
  "label":{"type":"plain_text","text":"Name"},
  "element":{
    "type":"plain_text_input",
    "action_id":"name_input"
  }
}
```

### Rich Text
```json
{
  "type":"rich_text",
  "elements":[
    {
      "type":"rich_text_section",
      "elements":[
        {"type":"text","text":"Hello "},
        {"type":"text","text":"bold","style":{"bold":true}},
        {"type":"user","user_id":"U1234"}
      ]
    }
  ]
}
```

## Text Object Types

### Plain Text
```json
{"type":"plain_text","text":"Simple text","emoji":true}
```

### Mrkdwn (Markdown)
```json
{"type":"mrkdwn","text":"*bold* _italic_ ~strike~ `code` ```preformatted```"}
```

## Mrkdwn Formatting

| Syntax | Result |
|--------|--------|
| `*text*` | **bold** |
| `_text_` | _italic_ |
| `~text~` | ~~strikethrough~~ |
| `` `code` `` | `inline code` |
| ` ```code``` ` | code block |
| `<URL\|text>` | link with text |
| `<@U1234>` | user mention |
| `<#C1234>` | channel mention |
| `<!here>` | @here |
| `<!channel>` | @channel |
| `<!everyone>` | @everyone |
| `:emoji:` | emoji |
| `> quote` | blockquote |
| `• item` | bullet list |
| `1. item` | numbered list |

## Element Types (for actions/accessories)

### Button
```json
{
  "type":"button",
  "text":{"type":"plain_text","text":"Click"},
  "action_id":"button_1",
  "style":"primary",  // or "danger", omit for default
  "url":"https://...", // optional: opens URL
  "value":"data"       // optional: passed to action handler
}
```

### Static Select
```json
{
  "type":"static_select",
  "placeholder":{"type":"plain_text","text":"Choose"},
  "action_id":"select_1",
  "options":[
    {"text":{"type":"plain_text","text":"Option 1"},"value":"opt1"},
    {"text":{"type":"plain_text","text":"Option 2"},"value":"opt2"}
  ]
}
```

### Users Select
```json
{
  "type":"users_select",
  "placeholder":{"type":"plain_text","text":"Select user"},
  "action_id":"user_select"
}
```

### Conversations Select
```json
{
  "type":"conversations_select",
  "placeholder":{"type":"plain_text","text":"Select channel"},
  "action_id":"channel_select"
}
```

### Date Picker
```json
{
  "type":"datepicker",
  "action_id":"date_pick",
  "initial_date":"2024-01-15",
  "placeholder":{"type":"plain_text","text":"Select date"}
}
```

### Overflow Menu
```json
{
  "type":"overflow",
  "action_id":"overflow_1",
  "options":[
    {"text":{"type":"plain_text","text":"Edit"},"value":"edit"},
    {"text":{"type":"plain_text","text":"Delete"},"value":"delete"}
  ]
}
```

### Checkboxes
```json
{
  "type":"checkboxes",
  "action_id":"checkboxes_1",
  "options":[
    {"text":{"type":"mrkdwn","text":"*Option 1*"},"value":"1"},
    {"text":{"type":"mrkdwn","text":"*Option 2*"},"value":"2"}
  ]
}
```

### Radio Buttons
```json
{
  "type":"radio_buttons",
  "action_id":"radio_1",
  "options":[
    {"text":{"type":"plain_text","text":"Option 1"},"value":"1"},
    {"text":{"type":"plain_text","text":"Option 2"},"value":"2"}
  ]
}
```

## Complete Message Example

```json
{
  "channel": "C1234567",
  "text": "Deployment notification",
  "blocks": [
    {
      "type": "header",
      "text": {"type": "plain_text", "text": "🚀 Deployment Complete"}
    },
    {
      "type": "section",
      "fields": [
        {"type": "mrkdwn", "text": "*Environment:*\nProduction"},
        {"type": "mrkdwn", "text": "*Version:*\nv2.1.0"}
      ]
    },
    {
      "type": "section",
      "text": {"type": "mrkdwn", "text": "Deployed by <@U1234> at <!date^1234567890^{date_short} {time}|timestamp>"}
    },
    {"type": "divider"},
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {"type": "plain_text", "text": "View Logs"},
          "url": "https://logs.example.com"
        },
        {
          "type": "button",
          "text": {"type": "plain_text", "text": "Rollback"},
          "style": "danger",
          "action_id": "rollback"
        }
      ]
    },
    {
      "type": "context",
      "elements": [
        {"type": "mrkdwn", "text": "Pipeline: main-deploy | Duration: 3m 42s"}
      ]
    }
  ]
}
```

## Limits

| Element | Limit |
|---------|-------|
| Blocks per message | 50 |
| Text length | 3000 chars |
| Actions per block | 25 |
| Options per select | 100 |
| Fields per section | 10 |

## Block Kit Builder

Design visually: https://app.slack.com/block-kit-builder
