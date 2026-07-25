#!/usr/bin/env python3
"""Generate AppleScript adding university class + exam events to an existing Calendar.

Usage:
  1. Edit CLASSES_C1, CLASSES_C2, EXAMS below
  2. Edit TARGET_CALENDAR to match your calendar name
  3. Run: python3 gen_cal.py && osascript /tmp/cal_events.scpt
"""

TARGET_CALENDAR = "Calendario"  # CHANGE THIS to your iCloud calendar
EVENT_PREFIX = "[US] "          # Prefix for easy identification/deletion

# Recurrence end dates in UTC: YYYYMMDDTHHMMSSZ
C1_UNTIL = "20261218T225900Z"   # 18 Dec 2026
C2_UNTIL = "20270524T215900Z"   # 24 May 2027

# Format: (title, start "DD/MM/YYYY HH:MM:SS", end, until_or_empty, "BYDAY" or "", is_exam)
CLASSES_C1 = [
    ("Pensamiento Hispanico", "8/9/2026 11:00:00", "8/9/2026 13:00:00", C1_UNTIL, "TU,WE", False),
    ("Logica y Lenguaje (L)", "7/9/2026 09:00:00", "7/9/2026 10:00:00", C1_UNTIL, "MO", False),
    ("Logica y Lenguaje (M)", "8/9/2026 09:00:00", "8/9/2026 11:00:00", C1_UNTIL, "TU", False),
    ("Logica y Lenguaje (X)", "9/9/2026 10:00:00", "9/9/2026 11:00:00", C1_UNTIL, "WE", False),
    ("Filosofia Actual, Tecnociencia y Sociedad", "10/9/2026 11:00:00", "10/9/2026 13:00:00", C1_UNTIL, "TH,FR", False),
    ("Seminario Logica y Filosofia de la Ciencia", "7/9/2026 13:00:00", "7/9/2026 15:00:00", C1_UNTIL, "MO,TU", False),
    ("Filosofia de la Ecologia (L)", "7/9/2026 16:00:00", "7/9/2026 17:00:00", C1_UNTIL, "MO", False),
    ("Filosofia de la Ecologia (M)", "8/9/2026 17:00:00", "8/9/2026 18:00:00", C1_UNTIL, "TU", False),
    ("Filosofia de la Ecologia (X)", "9/9/2026 16:00:00", "9/9/2026 17:00:00", C1_UNTIL, "WE", False),
    ("Filosofia de la Ecologia (J)", "10/9/2026 17:00:00", "10/9/2026 18:00:00", C1_UNTIL, "TH", False),
    ("Antropologia Filosofica II (M)", "8/9/2026 16:00:00", "8/9/2026 17:00:00", C1_UNTIL, "TU", False),
    ("Antropologia Filosofica II (X)", "9/9/2026 17:00:00", "9/9/2026 18:00:00", C1_UNTIL, "WE", False),
    ("Antropologia Filosofica II (J)", "10/9/2026 16:00:00", "10/9/2026 17:00:00", C1_UNTIL, "TH", False),
    ("Antropologia Filosofica II (V)", "11/9/2026 17:00:00", "11/9/2026 18:00:00", C1_UNTIL, "FR", False),
]

CLASSES_C2 = [
    ("Filosofia de las Matematicas", "27/1/2027 09:00:00", "27/1/2027 11:00:00", C2_UNTIL, "WE,FR", False),
    ("Historia de la Filosofia del Siglo XX", "26/1/2027 11:00:00", "26/1/2027 13:00:00", C2_UNTIL, "TU,WE", False),
    ("Filosofia Politica Contemporanea", "26/1/2027 16:00:00", "26/1/2027 18:00:00", C2_UNTIL, "MO,TU", False),
    ("Metodologia de la Investigacion (L)", "1/2/2027 17:00:00", "1/2/2027 19:00:00", C2_UNTIL, "MO", False),
    ("Metodologia de la Investigacion (X)", "27/1/2027 17:00:00", "27/1/2027 19:00:00", C2_UNTIL, "WE", False),
]

EXAMS = [
    ("Antropologia Filosofica II", "8/1/2027 16:00:00", "8/1/2027 18:00:00", "Aula F-4"),
    ("Filosofia de la Ecologia", "11/1/2027 16:00:00", "11/1/2027 18:00:00", "Aula F-4"),
    ("Logica y Lenguaje", "12/1/2027 10:00:00", "12/1/2027 12:00:00", "Aula F-4"),
    ("Pensamiento Hispanico", "12/1/2027 10:00:00", "12/1/2027 12:00:00", "Aula F-3"),
    ("Filosofia Actual, Tecnociencia y Sociedad", "19/1/2027 10:00:00", "19/1/2027 12:00:00", "Aula F-4"),
    ("Seminario Logica y Filosofia de la Ciencia", "21/1/2027 10:00:00", "21/1/2027 12:00:00", "Aula F-4"),
    ("Filosofia Politica Contemporanea", "28/5/2027 16:00:00", "28/5/2027 18:00:00", "Aula F-4"),
    ("Filosofia de las Matematicas", "1/6/2027 10:00:00", "1/6/2027 12:00:00", "Aula F-4"),
    ("Historia de la Filosofia del Siglo XX", "4/6/2027 10:00:00", "4/6/2027 12:00:00", "Aula F-4"),
    ("Metodologia de la Investigacion en Filosofia", "11/6/2027 16:00:00", "11/6/2027 18:00:00", "Aula F-3"),
]

lines = []
lines.append('tell application "Calendar"')
lines.append(f'set targetCal to calendar "{TARGET_CALENDAR}"')
lines.append('')

for title, start, end, extra, byday, is_exam in CLASSES_C1 + CLASSES_C2:
    name = f"{EVENT_PREFIX}{title}"
    lines.append(f'make new event at end of events of targetCal with properties {{summary:"{name}", start date:date "{start}", end date:date "{end}", recurrence:"FREQ=WEEKLY;UNTIL={extra};BYDAY={byday}"}}')

for title, start, end, loc in EXAMS:
    name = f"{EVENT_PREFIX}EXAMEN: {title}"
    lines.append(f'set ev to make new event at end of events of targetCal with properties {{summary:"{name}", start date:date "{start}", end date:date "{end}", location:"{loc}"}}')
    lines.append('tell ev to make new display alarm with properties {trigger interval:-1440}')

lines.append('')
lines.append('return "DONE"')
lines.append('end tell')

with open('/tmp/cal_events.scpt', 'w') as f:
    f.write('\n'.join(lines))

print(f"Generated /tmp/cal_events.scpt for calendar '{TARGET_CALENDAR}'")
print(f"Events: {len(CLASSES_C1)} C1 + {len(CLASSES_C2)} C2 + {len(EXAMS)} exams")
print("Run: osascript /tmp/cal_events.scpt")
