import sys
import os

try:
    import ifcopenshell
    import ifcopenshell.util.element as util_element
except ImportError:
    print("ERROR: ifcopenshell가 설치되어 있지 않습니다.")
    print("설치: pip install ifcopenshell")
    sys.exit(1)


def safe_filename(name: str) -> str:
    safe = "".join(c if c.isalnum() or c in "._- " else "_" for c in name)
    return safe.strip().replace(" ", "_")


def split_by_storey(ifc_path: str, output_dir: str):
    print(f"[split] 파일 열기: {ifc_path}")
    ifc = ifcopenshell.open(ifc_path)

    storeys = ifc.by_type("IfcBuildingStorey")
    print(f"[split] 발견된 층 수: {len(storeys)}")

    # 층이 없으면 아무 파일도 만들지 않고 종료
    # -> Node 쪽에서 공종별 fallback 하도록 함
    if not storeys:
        print("[split] 층 정보가 없습니다. 공종별 분할 fallback 대상으로 넘깁니다.")
        return

    for i, storey in enumerate(storeys):
        storey_name = storey.Name or f"storey_{i}"
        output_path = os.path.join(output_dir, f"{i:03d}_{safe_filename(storey_name)}.ifc")

        print(f"[split] [{i + 1}/{len(storeys)}] {storey_name} 추출 중...")

        try:
            elements = util_element.get_decomposition(storey)
            if not elements:
                print(" -> 요소 없음, 건너뜀")
                continue

            new_ifc = ifcopenshell.file(schema=ifc.schema)

            projects = ifc.by_type("IfcProject")
            if projects:
                try:
                    new_ifc.add(projects[0])
                except Exception:
                    pass

            for site in ifc.by_type("IfcSite"):
                try:
                    new_ifc.add(site)
                except Exception:
                    pass

            for building in ifc.by_type("IfcBuilding"):
                try:
                    new_ifc.add(building)
                except Exception:
                    pass

            try:
                new_ifc.add(storey)
            except Exception:
                pass

            for elem in elements:
                try:
                    new_ifc.add(elem)
                except Exception:
                    pass

            new_ifc.write(output_path)
            file_size = os.path.getsize(output_path)
            print(f" -> 저장: {output_path} ({file_size / (1024 * 1024):.1f}MB, {len(elements)}개 요소)")

        except Exception as e:
            print(f" -> 오류: {e}")
            continue

    print("[split] 분할 완료")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"사용법: {sys.argv[0]} <ifc_path> <output_dir>")
        sys.exit(1)

    ifc_path = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(ifc_path):
        print(f"ERROR: 파일을 찾을 수 없습니다: {ifc_path}")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    split_by_storey(ifc_path, output_dir)