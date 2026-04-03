import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";

/**
 * 대용량 IFC 변환 전략: 사전 분할 → 개별 변환 → .frag 병합
 *
 * 왜 이 방식인가:
 *   - readFileSync()는 2GiB 한계 (Node.js 제약)
 *   - web-ifc WASM은 ~4GB 메모리 상한 (Emscripten 빌드 제약)
 *   - 따라서 10GB IFC를 통째로 파싱하는 것은 현재 구조에서 불가능
 *   - IFC를 층별/공종별로 분할하면 각 조각이 1~2GB 이하가 되어
 *     기존 변환 파이프라인(web-ifc)으로 안전하게 처리 가능
 *
 * 파이프라인:
 *   1. Python/IfcOpenShell로 IFC를 층별 분할
 *   2. 각 분할 파일을 기존 converter.ts로 개별 변환
 *   3. 프론트에서 여러 .frag를 순차 로드
 *
 * 추후 Electron 확장 시:
 *   - 이 모듈을 Electron 메인 프로세스에서 직접 import
 *   - Python은 bundled binary로 포함하거나 pyinstaller로 패키징
 */

// ========= 설정 =========

const MAX_DIRECT_CONVERT_SIZE = 2 * 1024 * 1024 * 1024; // 2GB: 직접 변환 가능한 최대 크기

interface ChunkedConvertResult {
  success: boolean;
  fragFiles: string[];    // 생성된 .frag 파일 경로 목록
  totalChunks: number;
  failedChunks: string[];
  message: string;
}

// ========= 메인 함수 =========

/**
 * 대용량 IFC를 분할 변환한다.
 *
 * @param ifcPath   원본 IFC 파일 경로 (절대경로)
 * @param outputDir .frag 출력 디렉토리
 * @param fileId    파일 식별자 (Spring Boot에서 전달)
 */
export async function convertLargeIfc(
  ifcPath: string,
  outputDir: string,
  fileId: string
): Promise<ChunkedConvertResult> {
  const fileSize = fs.statSync(ifcPath).size;

  console.log(`[대용량 변환] 파일: ${ifcPath}`);
  console.log(`[대용량 변환] 크기: ${(fileSize / (1024 * 1024 * 1024)).toFixed(2)}GB`);

  // 2GB 이하면 기존 방식으로 직접 변환
  if (fileSize <= MAX_DIRECT_CONVERT_SIZE) {
    console.log(`[대용량 변환] 2GB 이하 → 직접 변환`);
    const { convertIfcToFrag } = await import("./converter");
    const fragPath = path.join(outputDir, `${fileId}.frag`);
    await convertIfcToFrag(ifcPath, fragPath);
    return {
      success: true,
      fragFiles: [fragPath],
      totalChunks: 1,
      failedChunks: [],
      message: "직접 변환 완료",
    };
  }

  // 2GB 초과 → 분할 변환
  console.log(`[대용량 변환] 2GB 초과 → 분할 변환 시작`);

  // 1단계: 분할 디렉토리 준비
  const chunksDir = path.join(outputDir, `${fileId}_chunks`);
  fs.mkdirSync(chunksDir, { recursive: true });

  // 2단계: Python/IfcOpenShell로 층별 분할
  console.log(`[1/3] IFC 분할 중 (IfcOpenShell)...`);
  const chunkFiles = await splitIfcByStorey(ifcPath, chunksDir);

  if (chunkFiles.length === 0) {
    // 층별 분할 실패 → 공종별(IfcWall, IfcSlab 등) 분할 시도
    console.log(`[1/3] 층별 분할 실패 → 공종별 분할 시도...`);
    const chunkFilesByType = await splitIfcByEntityType(ifcPath, chunksDir);

    if (chunkFilesByType.length === 0) {
      console.log(`[1/3] 공종별 분할도 실패. IfcOpenShell 설치를 확인하세요.`);
      return {
        success: false,
        fragFiles: [],
        totalChunks: 0,
        failedChunks: [],
        message: "IFC 분할 실패: pip install ifcopenshell 이 필요합니다.",
      };
    }

    // 공종별 분할 결과를 chunkFiles로 사용
    chunkFiles.push(...chunkFilesByType);
  }

  console.log(`[1/3] ${chunkFiles.length}개 청크로 분할 완료`);

  // 3단계: 각 청크를 .frag로 변환
  console.log(`[2/3] 청크별 .frag 변환 중...`);
  const { convertIfcToFrag } = await import("./converter");
  const fragFiles: string[] = [];
  const failedChunks: string[] = [];

  for (let i = 0; i < chunkFiles.length; i++) {
    const chunkPath = chunkFiles[i];
    const chunkName = path.basename(chunkPath, ".ifc");
    const fragPath = path.join(outputDir, `${fileId}_${chunkName}.frag`);

    try {
      const chunkSize = fs.statSync(chunkPath).size;
      console.log(`  [${i + 1}/${chunkFiles.length}] ${chunkName} (${(chunkSize / (1024 * 1024)).toFixed(0)}MB)`);

      await convertIfcToFrag(chunkPath, fragPath);
      fragFiles.push(fragPath);
    } catch (err: any) {
      console.error(`  [${i + 1}/${chunkFiles.length}] 변환 실패: ${chunkName}`, err.message);
      failedChunks.push(chunkName);
    }
  }

  console.log(`[3/3] 완료: ${fragFiles.length}/${chunkFiles.length} 성공`);

  // 청크 원본 정리 (선택적)
  // chunkFiles.forEach(f => fs.unlinkSync(f));

  return {
    success: fragFiles.length > 0,
    fragFiles,
    totalChunks: chunkFiles.length,
    failedChunks,
    message: `${fragFiles.length}/${chunkFiles.length}개 청크 변환 완료`,
  };
}

// ========= IFC 분할 (IfcOpenShell) =========

/**
 * IfcOpenShell을 사용하여 IFC를 층(IfcBuildingStorey)별로 분할한다.
 *
 * IfcOpenShell은 C++ 네이티브 파서로:
 *   - Node.js의 2GiB 파일 읽기 제한 없음
 *   - WASM 메모리 한계 없음
 *   - 스트리밍 방식으로 대용량 파일 처리 가능
 *
 * 필요 조건: python3 + ifcopenshell 설치
 *   pip install ifcopenshell
 */
async function splitIfcByStorey(
  ifcPath: string,
  outputDir: string
): Promise<string[]> {
  const scriptPath = path.join(__dirname, "split_ifc.py");

  // Python 분할 스크립트가 없으면 생성
  if (!fs.existsSync(scriptPath)) {
    createSplitScript(scriptPath);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [scriptPath, ifcPath, outputDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      process.stdout.write(data); // 실시간 출력
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on("close", (code: number) => {
      if (code !== 0) {
        console.error(`Python 분할 스크립트 실패 (code ${code}):`, stderr);
        resolve([]); // 실패 시 빈 배열
        return;
      }

      // 출력 디렉토리에서 생성된 .ifc 파일 목록
      const files = fs
        .readdirSync(outputDir)
        .filter((f) => f.endsWith(".ifc"))
        .map((f) => path.join(outputDir, f))
        .sort();

      resolve(files);
    });

    proc.on("error", (err: Error) => {
      console.error("Python 실행 오류:", err.message);
      resolve([]);
    });
  });
}

// ========= IFC 공종별 분할 (층 정보가 없는 IFC용 폴백) =========

/**
 * 층(IfcBuildingStorey) 정보가 없는 IFC 파일을 위한 폴백.
 * 공종(Entity Type: IfcWall, IfcSlab, IfcBeam 등) 별로 분할한다.
 *
 * 일부 IFC는 층 구조 없이 전체 요소가 플랫하게 들어 있는 경우가 있다.
 * 이 경우 공종별로 나누면 각 파일 크기를 줄일 수 있다.
 */
async function splitIfcByEntityType(
  ifcPath: string,
  outputDir: string
): Promise<string[]> {
  const scriptPath = path.join(__dirname, "split_ifc_by_type.py");

  if (!fs.existsSync(scriptPath)) {
    createSplitByTypeScript(scriptPath);
  }

  return new Promise((resolve) => {
    const proc = spawn("python3", [scriptPath, ifcPath, outputDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data: Buffer) => process.stdout.write(data));
    proc.stderr.on("data", (data: Buffer) => process.stderr.write(data));

    proc.on("close", (code: number) => {
      if (code !== 0) {
        resolve([]);
        return;
      }

      const files = fs
        .readdirSync(outputDir)
        .filter((f) => f.endsWith(".ifc"))
        .map((f) => path.join(outputDir, f))
        .sort();

      resolve(files);
    });

    proc.on("error", () => resolve([]));
  });
}

function createSplitByTypeScript(scriptPath: string) {
  const script = `#!/usr/bin/env python3
"""
IFC 파일을 공종(Entity Type) 별로 분할한다.
층(IfcBuildingStorey) 정보가 없는 IFC를 위한 폴백 전략.

사용법:
  python3 split_ifc_by_type.py <input.ifc> <output_dir>

설치:
  pip install ifcopenshell
"""

import sys
import os

try:
    import ifcopenshell
except ImportError:
    print("ERROR: ifcopenshell 미설치. pip install ifcopenshell")
    sys.exit(1)


# 분할 대상 공종 그룹
ENTITY_GROUPS = {
    "structure": ["IfcWall", "IfcWallStandardCase", "IfcColumn", "IfcBeam", "IfcSlab", "IfcFooting", "IfcPile"],
    "opening": ["IfcWindow", "IfcDoor", "IfcOpeningElement", "IfcCurtainWall"],
    "mep_hvac": ["IfcDuctSegment", "IfcDuctFitting", "IfcAirTerminal", "IfcFan", "IfcUnitaryEquipment"],
    "mep_plumbing": ["IfcPipeSegment", "IfcPipeFitting", "IfcValve", "IfcPump", "IfcSanitaryTerminal", "IfcFlowTerminal"],
    "mep_electrical": ["IfcCableSegment", "IfcCableFitting", "IfcElectricDistributionBoard", "IfcLightFixture", "IfcOutlet"],
    "furniture": ["IfcFurniture", "IfcFurnishingElement"],
    "space": ["IfcSpace", "IfcZone"],
    "misc": [],  # 위에 해당하지 않는 나머지
}


def split_by_type(ifc_path, output_dir):
    print(f"[split-type] 파일 열기: {ifc_path}")
    ifc = ifcopenshell.open(ifc_path)
    
    # 모든 Product 요소 수집
    all_products = ifc.by_type("IfcProduct")
    print(f"[split-type] 총 Product 수: {len(all_products)}")
    
    if not all_products:
        print("[split-type] Product 요소가 없습니다.")
        return
    
    # 그룹별로 분류
    grouped = {name: [] for name in ENTITY_GROUPS}
    all_known_types = set()
    for types in ENTITY_GROUPS.values():
        all_known_types.update(types)
    
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
    
    # 프로젝트 구조 요소
    project_elements = []
    for t in ["IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey"]:
        project_elements.extend(ifc.by_type(t))
    
    # 비어 있지 않은 그룹만 파일로 저장
    written = 0
    for group_name, elements in grouped.items():
        if not elements:
            continue
        
        output_path = os.path.join(output_dir, f"{group_name}.ifc")
        print(f"[split-type] {group_name}: {len(elements)}개 요소 → {output_path}")
        
        try:
            new_ifc = ifcopenshell.file(schema=ifc.schema)
            
            for pe in project_elements:
                try:
                    new_ifc.add(pe)
                except:
                    pass
            
            for elem in elements:
                try:
                    new_ifc.add(elem)
                except:
                    pass
            
            new_ifc.write(output_path)
            sz = os.path.getsize(output_path)
            print(f"  → 저장 완료 ({sz / (1024*1024):.1f}MB)")
            written += 1
        except Exception as e:
            print(f"  → 오류: {e}")
    
    print(f"[split-type] 완료: {written}개 파일 생성")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"사용법: {sys.argv[0]} <input.ifc> <output_dir>")
        sys.exit(1)
    
    ifc_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    if not os.path.exists(ifc_path):
        print(f"ERROR: 파일 없음: {ifc_path}")
        sys.exit(1)
    
    os.makedirs(output_dir, exist_ok=True)
    split_by_type(ifc_path, output_dir)
`;

  fs.writeFileSync(scriptPath, script);
  console.log(`[공종별 분할 스크립트 생성] ${scriptPath}`);
}

// ========= Python 분할 스크립트 자동 생성 =========

function createSplitScript(scriptPath: string) {
  const script = `#!/usr/bin/env python3
"""
IFC 파일을 IfcBuildingStorey(층) 단위로 분할한다.

사용법:
  python3 split_ifc.py <input.ifc> <output_dir>

IfcOpenShell의 C++ 파서를 사용하므로:
  - Node.js/WASM의 메모리 제한과 무관
  - 10GB+ IFC도 처리 가능 (디스크 I/O 기반)

설치:
  pip install ifcopenshell
"""

import sys
import os

try:
    import ifcopenshell
    import ifcopenshell.util.element as util_element
except ImportError:
    print("ERROR: ifcopenshell가 설치되어 있지 않습니다.")
    print("설치: pip install ifcopenshell")
    sys.exit(1)


def split_by_storey(ifc_path: str, output_dir: str):
    print(f"[split] 파일 열기: {ifc_path}")
    ifc = ifcopenshell.open(ifc_path)
    
    storeys = ifc.by_type("IfcBuildingStorey")
    print(f"[split] 발견된 층 수: {len(storeys)}")

    if not storeys:
        print("[split] 층 정보가 없습니다. 전체 파일을 그대로 복사합니다.")
        import shutil
        dest = os.path.join(output_dir, "full.ifc")
        shutil.copy2(ifc_path, dest)
        print(f"[split] 복사 완료: {dest}")
        return

    for i, storey in enumerate(storeys):
        storey_name = storey.Name or f"storey_{i}"
        # 파일명에 사용할 수 없는 문자 제거
        safe_name = "".join(c if c.isalnum() or c in "._- " else "_" for c in storey_name)
        safe_name = safe_name.strip().replace(" ", "_")
        
        output_path = os.path.join(output_dir, f"{i:03d}_{safe_name}.ifc")
        
        print(f"[split] [{i+1}/{len(storeys)}] {storey_name} 추출 중...")
        
        try:
            # 해당 층에 속한 모든 요소 수집
            elements = ifcopenshell.util.element.get_decomposition(storey)
            
            if not elements:
                print(f"  → 요소 없음, 건너뜀")
                continue
            
            # 새 IFC 파일 생성 (스키마 유지)
            new_ifc = ifcopenshell.file(schema=ifc.schema)
            
            # 프로젝트 구조 복사 (IfcProject, IfcSite, IfcBuilding)
            project = ifc.by_type("IfcProject")[0]
            new_ifc.add(project)
            
            for site in ifc.by_type("IfcSite"):
                new_ifc.add(site)
            for building in ifc.by_type("IfcBuilding"):
                new_ifc.add(building)
            
            # 층 + 하위 요소 추가
            new_ifc.add(storey)
            for elem in elements:
                try:
                    new_ifc.add(elem)
                except Exception:
                    pass  # 이미 추가된 요소 무시
            
            new_ifc.write(output_path)
            file_size = os.path.getsize(output_path)
            print(f"  → 저장: {output_path} ({file_size / (1024*1024):.1f}MB, {len(elements)}개 요소)")
            
        except Exception as e:
            print(f"  → 오류: {e}")
            continue

    print(f"[split] 분할 완료")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"사용법: {sys.argv[0]} <input.ifc> <output_dir>")
        sys.exit(1)
    
    ifc_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    if not os.path.exists(ifc_path):
        print(f"ERROR: 파일을 찾을 수 없습니다: {ifc_path}")
        sys.exit(1)
    
    os.makedirs(output_dir, exist_ok=True)
    split_by_storey(ifc_path, output_dir)
`;

  fs.writeFileSync(scriptPath, script);
  console.log(`[분할 스크립트 생성] ${scriptPath}`);
}
