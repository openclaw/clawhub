#!/bin/bash
# Shared byte formatting utilities
# Source this file: source "$(dirname "$0")/lib/format-bytes.sh"

# Format bytes to human-readable unit (auto-selects PB/TB/GB/MB/KB/bytes)
# Usage: format_bytes <bytes>
# Example: format_bytes 1500000000000 → "1.5 TB"
format_bytes() {
    local bytes="${1:-0}"
    
    # Handle non-numeric or empty input
    if ! [[ "$bytes" =~ ^[0-9]+\.?[0-9]*$ ]]; then
        echo "?"
        return
    fi
    
    # Use awk for portable floating-point comparison and formatting
    awk -v b="$bytes" 'BEGIN {
        if (b >= 1e15)      printf "%.1f PB", b / 1e15
        else if (b >= 1e12) printf "%.1f TB", b / 1e12
        else if (b >= 1e9)  printf "%.1f GB", b / 1e9
        else if (b >= 1e6)  printf "%.1f MB", b / 1e6
        else if (b >= 1e3)  printf "%.1f KB", b / 1e3
        else                printf "%.0f bytes", b
    }'
}

# Format bytes per day to human-readable rate
# Usage: format_bytes_rate <bytes>
# Example: format_bytes_rate 1500000000000 → "1.5 TB/day"
format_bytes_rate() {
    echo "$(format_bytes "$1")/day"
}

# Parse human-readable byte string to bytes (for input flexibility)
# Usage: parse_bytes "1.5TB" → 1500000000000
# Accepts: 100, 1.5KB, 2MB, 3.5GB, 4TB, 0.5PB (case-insensitive, space optional)
# Returns 0 and exits with code 1 for invalid input
parse_bytes() {
    local input="${1:-0}"
    
    # Remove spaces and convert to uppercase
    input=$(echo "$input" | tr -d ' ' | tr '[:lower:]' '[:upper:]')
    
    # Extract number and unit
    local num unit
    num=$(echo "$input" | sed 's/[^0-9.]//g')
    unit=$(echo "$input" | sed 's/[0-9.]//g')
    
    # Handle empty input or number
    if [[ -z "$input" || -z "$num" ]]; then
        echo "0"
        return 1
    fi
    
    # Validate number format (must be valid decimal, no multiple dots)
    if ! [[ "$num" =~ ^[0-9]+\.?[0-9]*$ ]]; then
        echo "0"
        return 1
    fi
    
    # Convert based on unit (reject unknown units)
    case "$unit" in
        PB) awk -v n="$num" 'BEGIN { printf "%.0f", n * 1e15 }' ;;
        TB) awk -v n="$num" 'BEGIN { printf "%.0f", n * 1e12 }' ;;
        GB) awk -v n="$num" 'BEGIN { printf "%.0f", n * 1e9 }' ;;
        MB) awk -v n="$num" 'BEGIN { printf "%.0f", n * 1e6 }' ;;
        KB) awk -v n="$num" 'BEGIN { printf "%.0f", n * 1e3 }' ;;
        B|BYTES|"") echo "$num" | awk '{ printf "%.0f", $1 }' ;;
        *) 
            # Unknown unit - return 0 and error
            echo "0"
            return 1
            ;;
    esac
}
