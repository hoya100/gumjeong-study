# © 2026 검정고시 연습 퀴즈. All rights reserved. 허락 없이 복제·재배포 금지.
"""'왜' 해설(flow_why.py 등)을 data/history.json에 적용하는 스크립트.

사용법: python3 tools/apply_why.py
- 이미 history.json에 있는 문제의 explanation(해설)만 바꿔요. 보기와 정답은 건드리지 않아요.
- 참고: build_questions.py는 이미 있는 id를 건너뛰므로, 해설 수정은 이 스크립트로 해요.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from flow_why import WHY  # noqa: E402

PATH = os.path.join(os.path.dirname(__file__), "..", "data", "history.json")
with open(PATH, encoding="utf-8") as f:
    data = json.load(f)

changed = 0
for q in data:
    if q["id"] in WHY:
        q["explanation"] = WHY[q["id"]].strip()
        changed += 1

missing = set(WHY) - {q["id"] for q in data}
if missing:
    sys.exit(f"history.json에 없는 id: {sorted(missing)}")

with open(PATH, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"해설 {changed}개를 바꿨어요.")
