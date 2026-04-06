import sys
import os

try:
    import ifcopenshell
except ImportError:
    print("ERROR: ifcopenshell 미설치. pip install ifcopenshell")
    sys.exit(1)

ENTITY_GROUPS = {
    "structure": [
        "IfcWall",
        "IfcWallStandardCase",
        "IfcColumn",
        "IfcBeam",
        "IfcSlab",
        "IfcFooting",
        "IfcPile",
    ],
    "opening": [
        "IfcWindow",
        "IfcDoor",
        "IfcOpeningElement",
        "IfcCurtainWall",
    ],
    "mep_hvac": [
        "IfcDuctSegment",
        "IfcDuctFitting",
        "IfcAirTerminal",
        "IfcFan",
        "IfcUnitaryEquipment",
    ],
    "mep_plumbing": [
        "IfcPipeSegment",
        "IfcPipeFitting",
        "IfcValve",
        "IfcPump",
        "IfcSanitaryTerminal",
        "IfcFlowTerminal",
    ],
    "mep_electrical": [
        "IfcCableSegment",
        "IfcCableFitting",
        "IfcElectricDistributionBoard",
        "IfcLightFixture",
        "IfcOutlet",
    ],
    "furniture": [
        "IfcFurniture",
        "IfcFurnishingElement",
    ],
    "space": [
        "IfcSpace",
        "IfcZone",
    ],
    "misc": [],
}


def split_by_type(ifc_path, output_dir):
    print(f"[split-type] 파일 열기: {ifc_path}")
    ifc = ifcopenshell.open(ifc_path)

    all_products = ifc.by_type("IfcProduct")
    print(f"[split-type] 총 Product 수: {len(all_products)}")

    if not all_products:
        print("[split-type] Product 요소가 없습니다.")
        return

    grouped = {name: [] for name in ENTITY_GROUPS}

    for elem in all_products:
        type_name = elem.is_a()
        placed = False

        for group_name, types in ENTITY_GROUPS.items():
            if type_name in types:
                grouped[group_name].append(elem)
                placed = True
                break

        if not placed:
            grouped["misc"].append(elem)

    project_elements = []
    for t in ["IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey"]:
        project_elements.extend(ifc.by_type(t))

    written = 0
    for group_name, elements in grouped.items():
        if not elements:
            continue

        output_path = os.path.join(output_dir, f"{group_name}.ifc")
        print(f"[split-type] {group_name}: {len(elements)}개 요소 -> {output_path}")

        try:
            new_ifc = ifcopenshell.file(schema=ifc.schema)

            for pe in project_elements:
                try:
                    new_ifc.add(pe)
                except Exception:
                    pass

            for elem in elements:
                try:
                    new_ifc.add(elem)
                except Exception:
                    pass

            new_ifc.write(output_path)
            sz = os.path.getsize(output_path)
            print(f" -> 저장 완료 ({sz / (1024 * 1024):.1f}MB)")
            written += 1

        except Exception as e:
            print(f" -> 오류: {e}")

    print(f"[split-type] 완료: {written}개 파일 생성")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"사용법: {sys.argv[0]} <ifc_path> <output_dir>")
        sys.exit(1)

    ifc_path = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(ifc_path):
        print(f"ERROR: 파일 없음: {ifc_path}")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    split_by_type(ifc_path, output_dir)