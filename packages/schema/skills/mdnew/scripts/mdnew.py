#!/usr/bin/env python3
import sys
import urllib.request
import urllib.parse

def fetch_markdown(url):
    # Construct the markdown.new URL
    md_new_url = f"https://markdown.new/{url}"
    
    # Request headers to match the tool's optimized behavior
    headers = {
        "Accept": "text/markdown, text/html",
        "User-Agent": "OpenClaw-MDNew-Skill/1.0"
    }
    
    try:
        req = urllib.request.Request(md_new_url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            content = response.read().decode('utf-8')
            # Extract custom headers if needed (e.g., token count)
            tokens = response.getheader('x-markdown-tokens')
            return content, tokens
    except Exception as e:
        return f"Error: {str(e)}", None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: mdnew <url>")
        sys.exit(1)
    
    target_url = sys.argv[1]
    markdown, token_count = fetch_markdown(target_url)
    
    if token_count:
        print(f"--- Estimated Tokens: {token_count} ---")
    print(markdown)
