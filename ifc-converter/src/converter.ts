import * as fs from "fs";
import * as path from "path";
import * as OBC from "@thatopen/components";
/**
 * IFC 파일을 .frag(Fragment) 파일로 변환한다.
 *
 * 이 함수는 독립적이므로:
 *   - 서버에서 HTTP로 호출 가능 (현재 구조)
 *   - Electron 메인 프로세스에서 직접 import 가능 (추후 확장)
 *   - CLI 도구로도 사용 가능
 *
 * @param ifcPath  입력 IFC 파일 경로
 * @param fragPath 출력 .frag 파일 경로
 */
export async function convertIfcToFrag(
  ifcPath: string,
  fragPath: string
): Promise<void> {
  if (!fs.existsSync(ifcPath)) {
    throw new Error(`IFC 파일을 찾을 수 없습니다: ${ifcPath}`);
  }

  // 출력 디렉토리 생성
  const outputDir = path.dirname(fragPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // That Open Components 초기화
  const components = new OBC.Components();
  const ifcLoader = components.get(OBC.IfcLoader);
  await ifcLoader.setup();

  // IFC 파일 읽기
  // Node.js는 브라우저와 달리 OS 가상 메모리를 활용하므로
  // 훨씬 큰 파일을 처리할 수 있다.
  console.log(`  IFC 파일 읽기 중: ${ifcPath}`);
  const ifcBuffer = fs.readFileSync(ifcPath);
  const ifcData = new Uint8Array(ifcBuffer);

  console.log(`  파일 크기: ${(ifcData.length / (1024 * 1024)).toFixed(1)}MB`);
  console.log(`  파싱 및 변환 중...`);

  // IFC → Fragment 변환
  const model = await ifcLoader.load(ifcData);

  // Fragment를 바이너리로 직렬화
  const fragmentsManager = components.get(OBC.FragmentsManager);
  const fragData = fragmentsManager.export(model);

  // .frag 파일 저장
  fs.writeFileSync(fragPath, Buffer.from(fragData));

  console.log(`  .frag 파일 저장 완료: ${fragPath}`);
  console.log(
    `  출력 크기: ${(fs.statSync(fragPath).size / (1024 * 1024)).toFixed(1)}MB`
  );

  components.dispose();
}

/*
 * ============================================================
 *  API 참고 사항 (@thatopen/components-back v2.x)
 * ============================================================
 *
 *
 *
 *  1) IfcLoader 직접 사용:
 *     const loader = components.get(OBC.IfcLoader);
 *     await loader.setup();
 *     const model = await loader.load(ifcData);
 *
 *  2) web-ifc 직접 사용 + FragmentsManager:
 *     import * as WEBIFC from "web-ifc";
 *     const ifcApi = new WEBIFC.IfcAPI();
 *     await ifcApi.Init();
 *     const modelID = ifcApi.OpenModel(ifcData);
 *
 *  실제 구현 시 @thatopen/components-back의 examples/ 폴더와
 *  공식 문서를 참고하세요: https://docs.thatopen.com/
 * ============================================================
 */
