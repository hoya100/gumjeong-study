"""신규 문제 원본(new_questions.py)을 data/history.json에 합치는 스크립트.

사용법: python3 tools/build_questions.py

- 보기 순서: 문제 id를 씨앗(seed)으로 섞어요. 같은 id면 항상 같은 순서가 나와서,
  다시 실행해도 결과가 바뀌지 않아요(재현 가능성). 검증을 마친 뒤 순서가 바뀌면 곤란하니까요.
- 이미 있는 id는 건너뛰어요. 두 번 실행해도 중복으로 들어가지 않아요.
"""
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
from new_questions import QUESTIONS  # noqa: E402

PATH = os.path.join(os.path.dirname(__file__), "..", "data", "history.json")

with open(PATH, encoding="utf-8") as f:
    data = json.load(f)

existing = {q["id"] for q in data}
added = 0
for qid, unit, question, correct, wrongs, explanation in QUESTIONS:
    if qid in existing:
        continue
    rng = random.Random(qid)
    choices = [correct] + wrongs
    rng.shuffle(choices)
    data.append({
        "id": qid,
        "unit": unit,
        "question": question,
        "choices": choices,
        "answer": choices.index(correct),
        "explanation": explanation,
        "source": "자체 제작",
    })
    added += 1

# 모든 문제에 '어떤 시험용인지' 표시. 나중에 한능검, 수능 문제를 같은 파일 구조로 넣을 때 구분용.
for q in data:
    q.setdefault("exam", "검정고시")

data.sort(key=lambda q: q["id"])

with open(PATH, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"추가 {added}개, 전체 {len(data)}개")
