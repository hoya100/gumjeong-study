"""과목별 문제 원본(tools/new_<과목>.py)을 data/<과목>.json으로 만드는 스크립트.

사용법: python3 tools/build_subject.py korean   (또는 english, math)

- 원본 파일에는 SUBJECT_FILE(만들 파일 이름)과 QUESTIONS 목록이 있어요.
  QUESTIONS 형식: (id, 단원, 질문, 정답, [오답 3개], 해설)
- 보기 순서는 문제 id를 씨앗(seed)으로 섞어요. 다시 실행해도 같은 결과가 나와요.
- 한국사(build_questions.py)와 달리 매번 파일 전체를 새로 만들어요.
  원본을 고치고 다시 실행하면 그대로 반영돼요.
"""
import importlib
import json
import os
import random
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)

name = sys.argv[1]
src = importlib.import_module("new_" + name)

data = []
for qid, unit, question, correct, wrongs, explanation in src.QUESTIONS:
    rng = random.Random(qid)
    choices = [correct] + list(wrongs)
    rng.shuffle(choices)
    data.append({
        "id": qid,
        "unit": unit,
        "question": question,
        "choices": choices,
        "answer": choices.index(correct),
        "explanation": explanation,
        "source": "자체 제작",
        "exam": "검정고시",
    })

out = os.path.join(HERE, "..", "data", src.SUBJECT_FILE)
with open(out, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"{src.SUBJECT_FILE}: {len(data)}문제")
