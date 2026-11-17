# © 2026 검정고시 연습 퀴즈. All rights reserved. 허락 없이 복제·재배포 금지.
"""문제 파일 형식 검사기.

사용법:  python3 tools/check_questions.py data/history.json

왜 필요한가:
  문제를 사람이든 AI든 대량으로 만들면 "보기가 3개뿐", "정답 번호가 4"
  같은 실수가 섞여요. 사이트에 올리기 전에 기계가 먼저 걸러내요.
  (내용이 '사실인지'는 이 스크립트가 못 봐요. 그건 교차 검증 단계의 몫이에요.)
"""
import json
import sys

import os

REQUIRED = ["id", "unit", "question", "explanation", "source", "exam"]
# 문제 종류별로 추가로 꼭 있어야 하는 항목
#  - 4지선다(기본): choices(보기 4개), answer(정답 번호)
#  - 흐름(order):   items(사건 4개, 정답 순서대로)
CONFIG = os.path.join(os.path.dirname(__file__), "..", "data", "config.json")


def allowed_units(path):
    """config.json에서 이 문제 파일을 쓰는 과목의 단원 목록을 찾아요.
    단원 이름에 오타가 있으면 단원별 통계에서 그 문제가 빠져버리기 때문에 꼭 확인해요."""
    with open(CONFIG, encoding="utf-8") as f:
        config = json.load(f)
    name = os.path.basename(path)
    for s in config["subjects"]:
        if s.get("file") and os.path.basename(s["file"]) == name:
            return {u["name"] for u in s.get("units", [])}
    return set()


def check(path):
    with open(path, encoding="utf-8") as f:
        questions = json.load(f)

    units_ok = allowed_units(path)
    errors = []
    seen_ids = set()
    seen_questions = set()

    for n, q in enumerate(questions, start=1):
        where = f"{n}번째 문제({q.get('id', '?')})"

        for key in REQUIRED:
            if key not in q or q[key] in ("", None):
                errors.append(f"{where}: '{key}' 항목이 비어 있어요")

        if units_ok and q.get("unit") not in units_ok:
            errors.append(f"{where}: 단원 '{q.get('unit')}'이 config.json 단원 목록에 없어요")

        if q.get("id") in seen_ids:
            errors.append(f"{where}: id가 중복돼요")
        seen_ids.add(q.get("id"))

        # 흐름 문제는 질문 문장이 모두 같으니, 사건 목록까지 묶어서 중복을 봐요.
        key = (q.get("question"), tuple(q.get("items", [])))
        if key in seen_questions:
            errors.append(f"{where}: 같은 문제가 이미 있어요")
        seen_questions.add(key)

        if q.get("type") == "order":
            items = q.get("items", [])
            if len(items) != 4:
                errors.append(f"{where}: 흐름 문제 사건이 {len(items)}개예요 (4개여야 해요)")
            if len(set(items)) != len(items):
                errors.append(f"{where}: 똑같은 사건이 있어요")
            continue

        choices = q.get("choices", [])
        if len(choices) != 4:
            errors.append(f"{where}: 보기가 {len(choices)}개예요 (4개여야 해요)")
        if len(set(choices)) != len(choices):
            errors.append(f"{where}: 똑같은 보기가 있어요")

        answer = q.get("answer")
        if not isinstance(answer, int) or not 0 <= answer < len(choices):
            errors.append(f"{where}: 정답 번호 {answer}가 보기 범위를 벗어나요 (0~3)")

    # 정답 위치 분포: 한 번호에 정답이 몰리면 문제를 만든 쪽의 버릇이 드러나요.
    # (사이트가 보기를 섞긴 하지만, 원본도 고르게 두는 게 좋아요.)
    spread = [0, 0, 0, 0]
    for q in questions:
        if q.get("type") == "order":
            continue
        if isinstance(q.get("answer"), int) and 0 <= q["answer"] < 4:
            spread[q["answer"]] += 1

    units = {}
    for q in questions:
        units[q.get("unit")] = units.get(q.get("unit"), 0) + 1

    flow = sum(1 for q in questions if q.get("type") == "order")
    print(f"문제 수: {len(questions)} (4지선다 {len(questions) - flow}, 흐름 {flow})")
    print("단원별:", ", ".join(f"{u} {c}" for u, c in units.items()))
    print("정답 위치(원본 기준 1~4번):", spread)

    if errors:
        print(f"\n문제 {len(errors)}건 발견:")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("\n형식 검사 통과")


if __name__ == "__main__":
    check(sys.argv[1] if len(sys.argv) > 1 else "data/history.json")
