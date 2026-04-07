# IFC Chunked Frag Conversion 주간 공유 정리

## 1. 한 줄 요약

4.76GB IFC 파일을 메모리에 한 번에 올리지 않고 스트리밍으로 분석해 800MB 기준 7개 IFC 청크로 분할하는 데 성공했다.  
이후 각 청크를 `.frag`로 변환하고, 최종 결과를 `manifest.json`으로 정리해 Spring Boot 백엔드와 프론트가 같은 기준으로 결과를 소비하도록 구성했다.

## 2. 왜 이 작업을 했는가

- 초대용량 IFC 파일은 단일 변환 방식으로 처리할 때 메모리 사용량과 실패 리스크가 크다.
- 특히 4GB 이상 파일은 전체 파싱 기반 처리에 부담이 커진다.
- 그래서 이번 구조는 "대용량 IFC 스트리밍 분할 -> 청크별 `.frag` 변환 -> `manifest.json`으로 결과 표준화" 흐름으로 설계했다.

## 3. 전체 개발 흐름

1. 사용자가 IFC 파일을 업로드한다.
2. Spring Boot 백엔드가 업로드 파일을 저장하고 변환 요청을 생성한다.
3. Spring Boot 백엔드가 Node 기반 `ifc-converter` 서비스에 변환을 요청한다.
4. `ifc-converter`가 `split_ifc_streaming.py`를 실행해 IFC를 청크 단위 IFC 파일로 분할한다.
5. 생성된 `chunk_001.ifc`, `chunk_002.ifc` 같은 임시 청크 IFC를 각각 `.frag`로 변환한다.
6. 변환이 끝나면 결과 요약 파일인 `manifest.json`을 생성한다.
7. Spring Boot 백엔드는 `manifest`, `frag`, `chunk frag` 다운로드 API를 노출한다.
8. 프론트는 변환 완료 상태를 확인한 뒤 청크 `.frag`를 순차적으로 다운로드하고 viewer에 로드한다.

## 4. 각 구성요소 역할

### Python splitter

- 파일: `ifc-converter/src/python/split_ifc_streaming.py`
- 역할: 초대용량 IFC를 메모리 전체 로딩 없이 스트리밍으로 읽어서 IFC 청크 파일로 분할
- 특징:
  - Pass 1: 엔티티 인덱스 구축, 참조 관계 수집, 엔티티 크기 계산
  - Pass 2: 층(storey) 기반 + 참조 클로저(BFS) 기반으로 청크 할당
  - Pass 3: 헤더, 글로벌 엔티티, 청크 소속 엔티티를 조합해 청크 IFC 파일 생성
- 핵심 의도:
  - `ifcopenshell.open()` 같은 전체 파싱 접근을 피하고
  - 4GB+ IFC도 비교적 안정적으로 분할할 수 있게 하는 것

### Node converter

- 파일: `ifc-converter/src/converter.ts`
- 역할:
  - Python splitter 호출
  - 생성된 IFC 청크들을 각각 `.frag`로 변환
  - 최종 `manifest.json` 생성
- 추가 특징:
  - Python splitter 실패 시 Fragments split worker로 fallback 가능
  - 임시 `tmp-ifc-chunks` 디렉터리는 변환 완료 후 정리

### Spring Boot 백엔드

- 파일:
  - `backend/src/main/java/com/kcmc/nexuraT/backend/domain/ifc/service/IfcConversionService.java`
  - `backend/src/main/java/com/kcmc/nexuraT/backend/domain/ifc/service/IfcFileService.java`
  - `backend/src/main/java/com/kcmc/nexuraT/backend/domain/ifc/controller/IfcFileController.java`
- 여기서 말하는 "백엔드"는 Spring Boot 애플리케이션을 의미한다.
- 역할:
  - 업로드 파일 저장
  - converter 서비스 호출
  - 변환 결과 경로와 상태 저장
  - `/api/ifc/{fileId}/frag/{chunkIndex}`
  - `/api/ifc/{fileId}/manifest`
    형태의 API로 결과 노출

### `ifcopenshell`의 역할

- 이 저장소에는 `ifcopenshell`을 사용하는 보조 스크립트가 존재한다.
  - `ifc-converter/src/python/split_ifc.py`
  - `ifc-converter/src/python/split_ifc_by_type.py`
- 이 스크립트들은 IFC를 파싱해 구조적으로 다루는 보조 경로에 가깝다.
- 반면 현재 메인 대용량 분할 경로인 `split_ifc_streaming.py`는 의도적으로 `ifcopenshell.open()`을 사용하지 않는다.
- 이유:
  - 4GB 이상 IFC에서는 전체 파싱 방식이 메모리 부담이 크다.
  - 이번 파이프라인의 1차 목표는 "일단 안전하게 자르고", 이후 청크별로 변환하는 것이다.
- 참고로 `.frag` 변환은 `ifcopenshell`이 아니라 `@thatopen/fragments`의 `IfcImporter`와 `web-ifc` WASM을 사용한다.

### Worker

- 이 프로젝트에는 서로 다른 역할의 worker가 2종류 있다.

`1) 서버 측 분할 worker`

- 파일: `ifc-converter/src/fragments-split-worker.ts`
- 역할:
  - Python splitter가 실패했을 때 사용하는 fallback worker
  - `FRAGS.split(...)`를 이용해 IFC를 여러 개 IFC 파일로 분할
  - 별도 Node 프로세스로 띄워 메모리 한계를 분리
- 특징:
  - `IFC_SPLIT_HEAP_MB` 또는 기본 `16384MB` heap을 사용하도록 설계
  - 즉, 무거운 분할 작업을 메인 Node 프로세스와 분리하는 안정장치

`2) 브라우저 측 viewer worker`

- 파일: `frontend/public/thatopen/worker.mjs`
- 역할:
  - 프론트의 `FragmentsManager.init(workerUrl)`에 전달되는 브라우저 전용 worker 번들
  - `.frag` 로드, 모델 처리, raycast, highlight, data 조회 같은 무거운 fragment 작업을 메인 UI 스레드 밖에서 수행
- 특징:
  - 직접 작성한 비즈니스 로직 파일이라기보다 That Open/Fragments 런타임이 번들된 worker 파일
  - UI 멈춤을 줄이고 viewer 상호작용을 안정화하는 데 목적이 있다

즉, 회의에서는 아래처럼 구분해서 설명하면 된다.

> `fragments-split-worker.ts`는 서버에서 IFC를 자르는 fallback worker이고,  
> `worker.mjs`는 브라우저에서 `.frag`를 다루는 viewer worker다.

### Frontend

- 파일:
  - `frontend/src/api/ifcApi.ts`
  - `frontend/src/components/viewer/components/IfcServerViewer.tsx`
- 역할:
  - 업로드 및 변환 상태 polling
  - 완료 후 chunk `.frag` 순차 다운로드
  - viewer에 chunk 단위로 로드

## 5. `manifest.json`은 왜 생성되는가

`manifest.json`은 단순 로그 파일이 아니라, 분할과 변환 결과를 시스템 전체가 공통 포맷으로 소비하기 위한 계약 파일이다.

### 의도

- 어떤 원본 IFC가 어떤 청크 `.frag`들로 변환되었는지 명확히 기록
- 총 청크 수, 생성 시각, 청크 목표 크기, 모드(`single`/`chunked`)를 일관된 형식으로 제공
- 각 청크의 파일명, 바이트 크기, 다운로드 경로를 한 곳에서 조회 가능하게 구성
- Spring Boot 백엔드, 프론트, 운영 관점에서 동일한 기준 데이터로 디버깅 가능
- 추후 프론트가 manifest 기반 동적 로딩 전략을 쓰더라도 확장 가능

### 중요한 포인트

- `manifest.json`은 `split_ifc_streaming.py`가 만드는 파일이 아니다.
- Python splitter는 "IFC 청크 파일 생성"까지만 담당한다.
- 실제 `manifest.json`은 Node converter의 `convertIfcToFragChunks()`에서 각 청크의 `.frag` 변환이 끝난 뒤 생성된다.

즉, 회의에서는 아래처럼 설명하면 된다.

> Python은 대용량 IFC를 안전하게 자르는 역할이고,  
> Node converter는 잘린 IFC를 `.frag`로 바꾸고 그 결과를 `manifest.json`으로 정리하는 역할이다.

## 6. `manifest.json`에 들어가는 정보

예시 구조:

```json
{
  "version": 1,
  "fileId": "...",
  "sourceIfcName": "...ifc",
  "createdAt": "...",
  "chunkTargetMb": 800,
  "totalChunks": 7,
  "mode": "chunked",
  "chunks": [
    {
      "index": 0,
      "sourceIfcName": "chunk_001.ifc",
      "fragFileName": "chunk_001.frag",
      "fragSizeBytes": 47802113,
      "downloadPath": "/api/ifc/{fileId}/frag/0"
    }
  ]
}
```

이 파일이 있으면 시스템은:

- 총 몇 개 청크를 받아야 하는지 알 수 있고
- 각 청크의 다운로드 위치를 알 수 있고
- 어떤 변환 결과가 생성되었는지 파일 하나로 추적할 수 있다

## 7. 이번 실행 로그 기준 결과

대상 실행:

- 모드: `chunked frag conversion`
- 원본 IFC: `66a6be70-939e-49ca-aeb6-f3c26243861b.ifc`
- 원본 크기: `4758.9 MB`
- 목표 청크 크기: `800 MB`

### Pass 1 결과

- 전체 엔티티 수: `2,662,614`
- 글로벌 엔티티 크기: `27.2 MB`
- 오버헤드 크기: `27.2 MB`
- 소요 시간: `9.5s`

의미:

- 전체 IFC를 스트리밍으로 읽으면서 엔티티 인덱스를 만든다.
- 엔티티 타입과 참조 관계를 추적한다.
- 공간 구조 정보와 뒤에서 사용할 실제 엔티티 바이트 크기를 계산한다.

### Pass 2 결과

- 층 기반 분할 시도: `1층`
- 해당 층 직접 요소 수: `21,632`
- 참조 클로저 포함 수: `173,056`
- 미분류 엔티티 추가: `2,403,011`
- 최종 청크 수: `7`
- 소요 시간: `0.8s`

의미:

- 가능한 경우 공간 구조(층)를 기준으로 먼저 묶는다.
- 참조되는 관련 엔티티까지 함께 포함해 데이터 일관성을 유지한다.
- 공간 구조에 바로 매핑되지 않는 엔티티는 별도로 모아 추가 청크 후보로 만든다.

기술적으로는:

- Pass 1에서 `IFCBUILDINGSTOREY`를 찾아 storey ID를 기록한다.
- 동시에 `IFCRELCONTAINEDINSPATIALSTRUCTURE`를 읽어 "어떤 요소가 어떤 층에 직접 포함되는지"를 수집한다.
- 각 층의 직접 요소 집합을 seed로 잡고, Pass 2에서 BFS를 수행해 참조 엔티티를 따라간다.
- 이 BFS는 `ref_map`을 사용해 현재 엔티티가 참조하는 다른 엔티티를 큐에 넣는 방식이다.
- 이때 `GLOBAL_TYPES`에 속하는 엔티티는 개별 청크 소유가 아니라 모든 청크에 공통 포함되는 전역 엔티티로 취급한다.
- 따라서 한 요소가 참조하는 형상, 배치, 타입, 속성, 관계선 같은 데이터가 필요한 범위까지 함께 따라붙는다.
- storey에 직접 매핑되지 않은 엔티티는 `unassigned` 집합으로 다시 모은다.
- 그 뒤 이 `unassigned` 집합도 독립 chunk 후보로 넣고, 각 후보 집합을 실제 바이트 크기 기준으로 다시 잘라 최종 chunk를 만든다.
- 실제 분할 한계치는 단순 `800MB`가 아니라, 헤더, 푸터, 글로벌 엔티티 오버헤드를 고려한 `effective_limit = target_bytes - overhead_size * 1.1` 형태로 계산한다.

### Pass 3 결과

- 최종 IFC 청크 파일 생성 완료
- 소요 시간: `8.9s`

생성 청크:

- `chunk_001.ifc`: `797.6 MB`
- `chunk_002.ifc`: `797.4 MB`
- `chunk_003.ifc`: `797.6 MB`
- `chunk_004.ifc`: `797.2 MB`
- `chunk_005.ifc`: `741.5 MB`
- `chunk_006.ifc`: `657.3 MB`
- `chunk_007.ifc`: `338.1 MB`

기술적으로는:

- 각 chunk 파일을 열 때 `header_text`와 `global_text`를 먼저 기록한다.
- 이후 원본 IFC를 다시 스트리밍으로 읽으면서, 각 엔티티를 자신이 배정된 chunk 파일에만 써 넣는다.
- 마지막에 모든 chunk 파일에 `footer_text`를 기록해 각각 독립적인 IFC 파일 형태로 마무리한다.

### 총괄 지표

- 전체 소요 시간: `19.2s`
- 생성 청크 수: `7`
- 청크 총합 크기: `4926.7 MB`
- 평균 청크 크기: `703.8 MB`
- 원본 대비 증가량: `167.8 MB` (`+3.5%`)

증가 이유:

- 각 청크가 독립적인 IFC 파일이 되려면 헤더, 푸터, 글로벌 엔티티를 함께 가져가야 한다.
- 그래서 원본 1개를 여러 개의 독립 IFC로 만들면 총합 용량이 원본보다 다소 커질 수 있다.

### 왜 800MB 기준인가

- 현재 기본값은 Spring 설정과 converter 기본값 둘 다 `800MB`로 맞춰져 있다.
- 즉, 이 값은 IFC 표준이 강제하는 숫자가 아니라 운영 기본값이다.

구현과 운영 관점에서 보면 800MB는 다음 균형점으로 해석할 수 있다.

- 너무 크게 잡으면 청크별 변환, 다운로드, viewer 로딩 시 메모리 스파이크가 다시 커진다.
- 너무 작게 잡으면 청크 수가 과도하게 늘어나고, chunk마다 반복되는 헤더와 글로벌 엔티티 오버헤드가 커진다.
- 1GB보다 약간 작은 수준으로 유지하면 대용량이지만 상대적으로 다루기 쉬운 파일 단위가 된다.
- 이번 4.76GB 사례에서는 7개 청크로 정리되어 네트워크, API, viewer 로딩 단계에서도 관리 가능한 수준을 유지했다.

즉, 800MB는 "청크 수를 지나치게 늘리지 않으면서도, 한 번에 다루기엔 너무 큰 파일을 안정적으로 나누기 위한 실무형 기본값"이라고 설명할 수 있다.

## 8. 이번 로그에서 꼭 짚고 갈 해석 포인트

### 1. 이번 로그는 "분할 성공"을 명확히 보여준다

- 4.76GB IFC를 19.2초 만에 7개 청크로 안정적으로 분할했다.
- 대용량 IFC 처리의 첫 번째 병목을 해소했다는 의미가 있다.

### 2. 800MB 목표는 잘 지켜졌다

- 앞 4개 청크는 거의 800MB 근처로 맞춰졌다.
- 뒤쪽 청크는 잔여 데이터와 참조 구조 영향으로 상대적으로 작아졌다.

### 3. storey 기반 분할은 "가능하면 사용" 전략이다

- 이번 로그에서는 storey 정보가 1층만 유효하게 잡혔다.
- 나머지는 미분류 엔티티로 처리되었고, 이 부분은 IFC 구조 품질에 따라 달라질 수 있다.

### 4. `manifest.json`은 분할 단계의 산출물이 아니라 변환 완료 단계의 산출물이다

- 지금 공유받은 로그만 보면 split 단계까지의 결과다.
- 실제 `manifest.json`은 이후 chunk `.frag` 변환이 끝나야 생성된다.

### 5. worker는 하나가 아니라 역할이 분리되어 있다

- 서버 측 worker는 분할 fallback 안정성을 담당한다.
- 브라우저 측 `worker.mjs`는 `.frag` 로딩과 viewer 상호작용 안정성을 담당한다.

## 9. 현재 코드 기준에서의 상태 정리

- `manifest.json` 생성 로직은 이미 구현되어 있다.
- Spring Boot 백엔드도 `manifest` 다운로드 API를 이미 제공한다.
- 프론트 타입에도 `manifestUrl`이 정의되어 있다.
- 다만 현재 viewer 로직은 아직 `manifest.json`을 직접 읽지 않고 `totalChunks`와 `frag/{chunkIndex}` API를 사용해 순차 로드하는 구조다.

즉:

- 시스템 관점에서는 manifest 기반 결과 관리가 준비되어 있고
- 프론트는 아직 manifest 직접 소비 전 단계라고 볼 수 있다

## 10. 회의에서 이렇게 설명하면 좋다

### 발표용 짧은 요약

이번 주에는 4.76GB IFC를 스트리밍 기반으로 안전하게 분할하는 파이프라인을 구현했다.  
800MB 목표 기준으로 7개 청크를 생성했고, 분할 단계는 약 19초 만에 완료됐다.  
이후 각 청크를 `.frag`로 변환하고, 최종 결과를 `manifest.json`으로 정리해 Spring Boot 백엔드와 프론트가 같은 기준으로 결과를 소비할 수 있도록 구성했다.

### 강조 포인트

- 초대용량 IFC를 메모리 전체 로딩 없이 처리 가능
- 청크 단위 `.frag` 변환으로 안정성 향상
- `manifest.json`으로 결과 관리 및 확장성 확보
- Spring Boot API까지 연결되어 있어 서비스 흐름이 거의 완성형에 가깝다
- 서버 측 worker와 브라우저 측 worker 역할이 분리되어 있어 안정성과 UI 응답성을 동시에 챙겼다

## 11. 근거 코드

- 분할 및 manifest 생성: `ifc-converter/src/converter.ts`
- 스트리밍 IFC 분할: `ifc-converter/src/python/split_ifc_streaming.py`
- fallback 분할 worker: `ifc-converter/src/fragments-split-worker.ts`
- converter 호출: `backend/src/main/java/com/kcmc/nexuraT/backend/domain/ifc/service/IfcConversionService.java`
- 결과 저장 및 manifest API: `backend/src/main/java/com/kcmc/nexuraT/backend/domain/ifc/service/IfcFileService.java`
- manifest, frag API: `backend/src/main/java/com/kcmc/nexuraT/backend/domain/ifc/controller/IfcFileController.java`
- Spring 설정: `backend/src/main/resources/application-ifc.yml`
- 프론트 변환, 다운로드: `frontend/src/api/ifcApi.ts`
- 프론트 viewer 로딩: `frontend/src/components/viewer/components/IfcServerViewer.tsx`
- 브라우저 worker 초기화 예시: `frontend/src/components/viewer/components/IfcViewerPanel.tsx`
- 브라우저 worker 파일: `frontend/public/thatopen/worker.mjs`

## 12. 참고

현재 워크스페이스에는 예시 `manifest.json`이 존재하지만, 이번에 공유된 `66a6be70-939e-49ca-aeb6-f3c26243861b` 실행 결과용 `manifest.json` 파일은 직접 확인되지는 않았다.  
따라서 이번 문서에서는:

- 실행 로그로 확인된 사실은 그대로 반영했고
- `manifest.json`, worker, 800MB 기준, 분할 알고리즘 설명은 코드 구현 기준으로 정리했다
