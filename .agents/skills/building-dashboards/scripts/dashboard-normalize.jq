def normalize_dashboard_layout:
  if .layout then
    .layout = [.layout[] |
      .minH = (.minH // (if .h <= 2 then .h else 2 end)) |
      .minW = (.minW // 2) |
      .moved = (.moved // false) |
      .static = (.static // false)
    ]
  else .
  end;
