import type { EditableWbsRow } from "./types";

/**
 * "사실상 무한대"로 쓸 큰 숫자.
 * backward pass에서 아직 제한값이 정해지지 않았음을 표현할 때 사용한다.
 */
const INF = Math.floor(Number.MAX_SAFE_INTEGER / 4);

function normalizeWbsCode(value: string): string {
    return value.trim().toUpperCase();
}

function parseFiniteNumber(value: string | number | null | undefined, fieldName: string, rowLabel: string): number {
    if (value == null || String(value).trim() === "") {
        throw new Error(`CPM 입력 오류: ${rowLabel}의 ${fieldName} 값이 비어 있습니다.`);
    }

    const n = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(n)) {
        throw new Error(`CPM 입력 오류: ${rowLabel}의 ${fieldName} 값이 숫자가 아닙니다. (${value})`);
    }

    return n;
}

function parseDurationDays(value: string | number | null | undefined, rowLabel: string): number {
    const duration = parseFiniteNumber(value, "durationDays", rowLabel);

    if (duration < 0) {
        throw new Error(`CPM 입력 오류: ${rowLabel}의 durationDays 는 음수일 수 없습니다. (${duration})`);
    }

    return duration;
}

/**
 * 선행관계 1건을 표현하는 타입
 *
 * code : 선행 작업의 WBS 코드
 * rel  : 관계 유형
 *        - FS = Finish to Start
 *        - SS = Start to Start
 *        - FF = Finish to Finish
 *        - SF = Start to Finish
 * lag  : 지연일수
 *
 * 예)
 * "A100 FS+2" 라면
 *   code = "A100"
 *   rel  = "FS"
 *   lag  = 2
 */
interface Dependency {
    code: string;
    rel: "FS" | "SS" | "FF" | "SF";
    lag: number;
}

/**
 * CPM 계산에 사용할 "계산용 노드"
 *
 * 원본 row를 그대로 계산하지 않고, 계산에 필요한 값만 묶어서 사용한다.
 *
 * row          : 원본 데이터 row
 * key          : nodeMap에서 사용할 고유 키 (현재 프로젝트 전제상 wbsCode 자체가 유일키)
 * predecessors : 이 작업의 선행작업 목록
 * successors   : 이 작업의 후행작업 목록
 *
 * ES / EF / LS / LF / TF / FF / isCritical 는 CPM 계산 결과값
 */
interface ActivityNode {
    row: EditableWbsRow;
    key: string;
    predecessors: Dependency[];
    successors: Dependency[];
    es: number;
    ef: number;
    ls: number;
    lf: number;
    tf: number;
    ff: number;
    isCritical: boolean;
}

/**
 * predecessorCode 안의 토큰 1개를 파싱한다.
 *
 * 지원 형태:
 * 1) 코드 + 관계 + lag 이 한 문자열에 모두 들어있는 경우
 *    예: "A100FS+2", "A100 SS-1"
 *
 * 2) 코드만 들어있는 경우
 *    예: "A100"
 *    -> 이 경우 기본값으로 FS, lag 0 을 사용한다.
 *
 * 반환값은 Dependency 객체이며,
 * 나중에 relationType / lag 컬럼과 조합해서 최종 선행관계를 확정할 수도 있다.
 */
function parseDependency(token: string): Dependency {
    // 공백 제거 + 대문자 통일
    const normalized = token.trim().toUpperCase();

    /**
     * 정규식 설명
     * ^(.+?)(FS|SS|FF|SF)([+-]\d+)?$
     *
     * 1그룹: 선행작업 코드
     * 2그룹: 관계유형(FS/SS/FF/SF)
     * 3그룹: lag(+2, -1 등) - 없을 수도 있음
     */
    const pattern = /^(.+?)(FS|SS|FF|SF)([+-]\d+)?$/;
    const m = normalized.match(pattern);

    // "코드+관계+lag" 형태가 맞게 들어온 경우
    if (m) {
        const code = m[1].trim();
        const rel = m[2] as Dependency["rel"];
        const lag = m[3] ? parseInt(m[3], 10) : 0;

        // 코드가 비어 있으면 잘못된 데이터로 간주
        if (!code) throw new Error(`Missing predecessor code in token: ${token}`);

        return { code, rel, lag };
    }

    // 관계유형/lag 없이 코드만 들어온 경우 -> 기본값 사용
    const codeOnly = normalized.trim();
    if (codeOnly) return { code: codeOnly, rel: "FS", lag: 0 };

    // 완전히 이상한 값이면 예외 처리
    throw new Error(`Invalid dependency token: ${token}`);
}

/**
 * relationType 컬럼을 파싱한다.
 *
 * 예)
 * "FS,SS,FF" -> ["FS", "SS", "FF"]
 *
 * 중요한 점:
 * - predecessorCode 와 relationType 은 "같은 순서"로 짝지어진다고 가정한다.
 * - 그래서 개수/인덱스를 최대한 유지해야 한다.
 * - 빈 값이나 잘못된 값은 기본값 "FS"로 보정한다.
 *
 * 즉, relationType 이 비어 있어도 계산이 끊기지 않게 해주는 역할이다.
 */
function parseRelationValues(value: unknown): Dependency["rel"][] {
    // 필터링하지 않고 인덱스가 유지되도록 원소 개수를 보장한다.
    // 비어 있거나 유효하지 않은 값은 기본값("FS")을 전달한다.
    return String(value ?? "")
        .split(",")
        .map(v => {
            const u = v.trim().toUpperCase();
            if (u === "FS" || u === "SS" || u === "FF" || u === "SF") return u as Dependency["rel"];
            return "FS" as Dependency["rel"];
        });
}

/**
 * lag 컬럼을 파싱한다.
 *
 * 예)
 * "2,-1,0" -> [2, -1, 0]
 *
 * 주의:
 * 현재 구현은 빈 문자열을 filter로 제거하고 있기 때문에,
 * relationType 쪽보다 인덱스 정합성이 조금 약할 수 있다.
 *
 * 예를 들어 lag가 "2,,5" 라면 결과는 [2,5] 가 된다.
 * 즉, 중간 빈 값이 사라진다.
 *
 * 만약 predecessorCode / relationType / lag 의 "인덱스 1:1 대응"을
 * 아주 엄격하게 유지해야 한다면, 이 함수도 relationType처럼
 * 빈 값은 0으로 남기도록 바꾸는 게 더 안전하다. -->  나중에 할거!!!!!!!!!!
 */
function parseLagValues(value: unknown, rowLabel: string): number[] {
    return String(value ?? "")
        .split(",")
        .map(v => v.trim())
        .map(v => {
            if (v === "") return 0;
            const n = parseInt(v, 10);
            if (Number.isNaN(n)) {
                throw new Error(`CPM 입력 오류: ${rowLabel}의 lag 값이 숫자가 아닙니다. (${v})`);
            }
            return n;
        });
}

/**
 * forward pass에서 "선행작업 1건"이 현재 작업의 ES(조기착수일)에
 * 어떤 제약을 주는지 계산한다.
 *
 * pred : 선행 노드
 * succ : 현재(후행) 노드
 * rel  : 관계유형
 * lag  : 지연
 *
 * 반환값:
 * - 이 선행관계 때문에, 현재 작업은 최소 몇 일째에 시작해야 하는가
 *
 * 관계별 해석:
 * - FS: 선행이 끝난 뒤 lag만큼 지나야 후행 시작 가능
 * - SS: 선행이 시작한 뒤 lag만큼 지나야 후행 시작 가능
 * - FF: 선행이 끝난 뒤 lag만큼 지나야 후행 종료 가능
 *       -> 후행 시작일로 환산하려면 후행 duration을 빼야 함
 * - SF: 선행이 시작한 뒤 lag만큼 지나야 후행 종료 가능
 *       -> 역시 시작일 환산을 위해 duration을 뺀다
 */
function forwardConstraint(pred: ActivityNode, succ: ActivityNode, rel: Dependency["rel"], lag: number): number {
    const dur = parseDurationDays(succ.row.durationDays, `작업 ${succ.key}`);

    switch (rel) {
        case "FS": return pred.ef + lag;
        case "SS": return pred.es + lag;
        case "FF": return pred.ef + lag - dur;
        case "SF": return pred.es + lag - dur;
    }
}

/**
 * backward pass에서 "후행작업 1건"이 현재 작업의 LS/LF 에 주는 제한을 계산한다.
 *
 * 반환값:
 * [candLS, candLF]
 *
 * 의미:
 * - 어떤 관계는 "최대 LF"만 제한한다.
 * - 어떤 관계는 "최대 LS"만 제한한다.
 *
 * 예)
 * - FS는 후행의 LS를 기준으로 현재 작업의 LF 상한이 정해짐
 * - SS는 후행의 LS를 기준으로 현재 작업의 LS 상한이 정해짐
 *
 * 제한이 없는 쪽은 INF로 남겨서 "아직 제한 없음"으로 처리한다.
 */
function backwardConstraintLimits(succ: ActivityNode, rel: Dependency["rel"], lag: number): [number, number] {
    let candLS = INF;
    let candLF = INF;

    switch (rel) {
        case "FS": candLF = succ.ls - lag; break;
        case "SS": candLS = succ.ls - lag; break;
        case "FF": candLF = succ.lf - lag; break;
        case "SF": candLS = succ.lf - lag; break;
    }

    return [candLS, candLF];
}

/**
 * Free Float(여유시차)를 계산한다.
 *
 * Free Float 정의:
 *   "현재 작업이 늦어져도, 직접 후행작업의 조기시작/조기종료에 영향을 주지 않는 범위"
 *
 * 로직:
 * - 현재 작업의 모든 후행작업을 확인한다.
 * - 각각에 대해 slack(여유)을 계산한다.
 * - 그 중 가장 작은 값을 Free Float으로 본다.
 *
 * 후행이 하나도 없으면 Free Float은 0으로 둔다.
 */
function computeFreeFloat(node: ActivityNode, nodeMap: Map<string, ActivityNode>): number {
    if (node.successors.length === 0) return 0;

    let minSlack = INF;

    for (const sdep of node.successors) {
        const succ = nodeMap.get(sdep.code);
        if (!succ) continue;

        // 어떤 관계유형이든 값이 정해지도록 기본값 0으로 시작
        let slack = 0;

        switch (sdep.rel) {
            case "FS": slack = succ.es - (node.ef + sdep.lag); break;
            case "SS": slack = succ.es - (node.es + sdep.lag); break;
            case "FF": slack = succ.ef - (node.ef + sdep.lag); break;
            case "SF": slack = succ.ef - (node.es + sdep.lag); break;
        }

        if (slack < minSlack) minSlack = slack;
    }

    // 끝까지 INF면 정상 계산된 후행이 없었다는 뜻이므로 0 처리
    return minSlack >= INF ? 0 : minSlack;
}

/**
 * 위상정렬(topological sort)
 *
 * 목적:
 * - forward pass를 하려면 선행작업이 먼저 계산되어 있어야 한다.
 * - 즉, "선행 -> 후행" 순서로 노드를 정렬해야 한다.
 *
 * 방식:
 * - 각 노드의 진입차수(inDegree = 선행작업 개수)를 구한다.
 * - inDegree가 0인 노드부터 큐에 넣는다.
 * - 하나씩 꺼내면서 그 노드의 후행작업들의 inDegree를 감소시킨다.
 * - 0이 되면 큐에 넣는다.
 *
 * 결과:
 * - 선행관계를 만족하는 정렬 순서가 만들어진다.
 * - 만약 순환(cycle)이 있으면 모든 노드를 다 꺼낼 수 없게 된다.
 */
function topologicalSort(nodeMap: Map<string, ActivityNode>): ActivityNode[] {
    const inDegree = new Map<string, number>();

    // 모든 노드의 진입차수를 우선 0으로 초기화
    for (const key of nodeMap.keys()) inDegree.set(key, 0);

    // 실제 진입차수 = 선행작업 개수
    for (const node of nodeMap.values()) inDegree.set(node.key, node.predecessors.length);

    const queue: ActivityNode[] = [];

    // 선행작업이 없는 시작 노드들을 먼저 큐에 넣는다.
    for (const [key, deg] of inDegree.entries()) {
        if (deg === 0) queue.push(nodeMap.get(key)!);
    }

    const result: ActivityNode[] = [];

    while (queue.length > 0) {
        const current = queue.shift()!;
        result.push(current);

        // current를 처리했으므로 current를 선행으로 갖는 후행작업들의 진입차수를 1 감소
        for (const sdep of current.successors) {
            const newDeg = (inDegree.get(sdep.code) ?? 1) - 1;
            inDegree.set(sdep.code, newDeg);

            // 진입차수가 0이 되면 이제 처리 가능한 노드이므로 큐에 투입
            if (newDeg === 0) {
                const next = nodeMap.get(sdep.code);
                if (next) queue.push(next);
            }
        }
    }

    return result;
}

/**
 * CPM 계산 메인 함수
 *
 * 전체 흐름:
 * 1. 계산 대상 row(leaf + duration 있음)만 고른다.
 * 2. 각 row를 ActivityNode로 변환해 nodeMap을 만든다.
 * 3. predecessorCode / relationType / lag 를 해석해 선행/후행 연결을 만든다.
 * 4. 위상정렬을 한다.
 * 5. forward pass 로 ES/EF 계산
 * 6. projectDuration 계산
 * 7. backward pass 로 LS/LF 계산
 * 8. TF/FF/critical 계산
 * 9. 계산 결과를 원본 rows에 다시 반영해서 반환
 */
export function calculateCpm(rows: EditableWbsRow[]): EditableWbsRow[] {
    /**
     * [1] CPM 계산 대상 필터링
     *
     * 현재 프로젝트 전제:
     * - wbsCode는 유일하다.
     * - CPM은 "최하위 작업(leaf)" 에 대해서만 수행한다.
     *
     * 따라서 아래 조건을 만족하는 row만 계산 대상으로 삼는다.
     * - wbsCode 존재
     * - hasChildren === false (자식 없음)
     * - durationDays 존재
     */
    const eligible = rows.filter(r =>
        r.wbsCode &&
        r.hasChildren === false &&
        r.durationDays != null &&
        String(r.durationDays).trim() !== ""
    );

    /**
     * [2] 계산용 노드 맵 생성
     *
     * key = wbsCode 대문자/trim 정규화 값
     *
     * 프로젝트 전제상 wbsCode가 유일하므로
     * 별도 predKey, rowIndex, level 조합 없이 wbsCode만 키로 사용한다.
     */
    const nodeMap = new Map<string, ActivityNode>();

    for (const row of eligible) {
        const key = normalizeWbsCode(row.wbsCode);
        const rowLabel = `작업 ${key}`;

        parseDurationDays(row.durationDays, rowLabel);

        if (nodeMap.has(key)) {
            throw new Error(`CPM 입력 오류: 중복된 WBS Code(${key})가 있습니다.`);
        }

        nodeMap.set(key, {
            row,
            key,
            predecessors: [],
            successors: [],
            es: 0,
            ef: 0,
            ls: 0,
            lf: 0,
            tf: 0,
            ff: 0,
            isCritical: false,
        });
    }

    /**
     * [3] 선행관계 연결
     *
     * 여기서 하는 일:
     * - predecessorCode 를 읽는다.
     * - 각 선행코드를 Dependency 형태로 파싱한다.
     * - 현재 노드의 predecessors 에 넣는다.
     * - 동시에 선행 노드의 successors 에도 현재 노드를 넣는다.
     *
     * 즉, 양방향 연결을 만든다.
     *
     * 예)
     * B의 predecessor가 A라면
     * - B.predecessors 에 A 추가
     * - A.successors   에 B 추가
     */
    for (const node of nodeMap.values()) {
        const predCodeRaw = node.row.predecessorCode;
        const rowLabel = `작업 ${node.key}`;

        // 선행작업이 없는 시작 작업이면 건너뜀
        if (!predCodeRaw || !predCodeRaw.trim()) continue;

        /**
         * predecessorCode 는 콤마로 여러 개가 들어올 수 있다.
         * 예) "A100,B200FS+2,C300"
         */
        const predCodes = predCodeRaw.split(",").map(s => s.trim()).filter(Boolean);

        /**
         * relationType / lag 는 predecessorCode 와 같은 인덱스로 짝지어진다고 가정한다.
         *
         * 예)
         * predecessorCode = "A100,B200"
         * relationType    = "FS,SS"
         * lag             = "0,3"
         *
         * 그러면
         * - A100 -> FS, 0
         * - B200 -> SS, 3
         */
        const relTypes = parseRelationValues(node.row.relationType);
        const lagValues = parseLagValues(node.row.lag, rowLabel);

        if (String(node.row.relationType ?? "").trim() !== "" && relTypes.length !== predCodes.length) {
            throw new Error(
                `CPM 입력 오류: ${rowLabel}의 predecessorCode(${predCodes.length})와 relationType(${relTypes.length}) 개수가 맞지 않습니다.`
            );
        }

        if (String(node.row.lag ?? "").trim() !== "" && lagValues.length !== predCodes.length) {
            throw new Error(
                `CPM 입력 오류: ${rowLabel}의 predecessorCode(${predCodes.length})와 lag(${lagValues.length}) 개수가 맞지 않습니다.`
            );
        }

        for (let i = 0; i < predCodes.length; i++) {
            const token = predCodes[i];

            let dep: Dependency;

            try {
                /**
                 * 1차 파싱:
                 * token 자체에 관계유형/lag가 들어 있으면 여기서 바로 파싱됨
                 * 예) "A100FS+2"
                 */
                dep = parseDependency(token);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`CPM 입력 오류: ${rowLabel}의 선행작업 값 "${token}" 을 해석할 수 없습니다. ${message}`);
            }

            /**
             * token 안에 관계유형이 직접 들어 있는지 확인
             *
             * 예)
             * - "A100FS+2" -> true
             * - "A100"     -> false
             */
            const hasEmbeddedRel = /^.+(FS|SS|FF|SF)([+-]\d+)?$/i.test(token);

            /**
             * token이 단순 코드만 들어온 경우,
             * relationType / lag 컬럼에서 같은 인덱스 값을 가져와서 보완한다.
             *
             * 예)
             * predecessorCode = "A100"
             * relationType    = "SS"
             * lag             = "3"
             *
             * => 최종 dep = { code:"A100", rel:"SS", lag:3 }
             */
            if (!hasEmbeddedRel) {
                const rel = relTypes[i] || relTypes[0] || "FS";
                const lag = lagValues[i] ?? lagValues[0] ?? 0;
                dep = { code: dep.code, rel, lag };
            }

            if (normalizeWbsCode(dep.code) === node.key) {
                throw new Error(`CPM 입력 오류: ${rowLabel}가 자기 자신을 선행작업으로 참조하고 있습니다.`);
            }

            /**
             * 선행작업 code가 실제 계산 대상(nodeMap)에 존재하는지 확인
             * 없으면 연결하지 않는다.
             *
             * 보통 아래 경우에 없을 수 있다:
             * - 선행작업이 leaf가 아님
             * - duration이 없어 CPM 대상에서 제외됨
             * - 입력 데이터 누락
             */
            const predNode = nodeMap.get(normalizeWbsCode(dep.code));
            if (!predNode) {
                throw new Error(
                    `CPM 입력 오류: ${rowLabel}의 선행작업 ${dep.code} 를 찾을 수 없습니다. ` +
                    "선행작업이 leaf가 아니거나 durationDays 가 비어 있을 수 있습니다."
                );
            }

            /**
             * 현재 노드 입장에서 선행작업 추가
             */
            node.predecessors.push(dep);

            /**
             * 선행 노드 입장에서 후행작업 추가
             *
             * successors 에서는 "내 뒤에 오는 작업"을 적어야 하므로
             * code 는 현재 node.key 가 된다.
             */
            predNode.successors.push({
                code: node.key,
                rel: dep.rel,
                lag: dep.lag,
            });
        }
    }

    /**
     * [4] 위상정렬
     *
     * forward pass는 선행이 먼저 계산되어 있어야 하므로,
     * 반드시 위상정렬 순서대로 돌아야 한다.
     */
    const sorted = topologicalSort(nodeMap);

    /**
     * 위상정렬 결과 개수가 전체 노드 수와 다르면
     * 어딘가에 순환(cycle)이 있다는 뜻이다.
     *
     * 예)
     * A -> B
     * B -> C
     * C -> A
     */
    if (sorted.length !== nodeMap.size) {
        throw new Error("CPM 계산 오류: 선행관계에 순환(cycle)이 감지되었습니다.");
    }

    /**
     * [5] Forward Pass
     *
     * 각 작업의 ES / EF 계산
     *
     * 원칙:
     * - 선행이 없는 작업은 ES = 0부터 시작
     * - 선행이 여러 개면, 그중 가장 늦게 시작 가능하게 만드는 제약(max)을 택한다.
     */
    for (const node of sorted) {
        let esVal = 0;

        for (const dep of node.predecessors) {
            const pred = nodeMap.get(normalizeWbsCode(dep.code));
            if (!pred) continue;

            // 선행관계 1건이 요구하는 최소 시작 가능 시점
            const cand = forwardConstraint(pred, node, dep.rel, dep.lag);

            // 여러 선행조건 중 가장 큰 값이 실제 ES
            if (cand > esVal) esVal = cand;
        }

        node.es = esVal;
        node.ef = node.es + parseDurationDays(node.row.durationDays, `작업 ${node.key}`);
    }

    /**
     * [6] 프로젝트 총 기간 계산
     *
     * 모든 작업의 EF 중 최댓값 = 프로젝트 전체 완료시점
     */
    let projectDuration = 0;
    for (const node of nodeMap.values()) {
        if (node.ef > projectDuration) projectDuration = node.ef;
    }

    /**
     * [7] Backward Pass
     *
     * 뒤에서부터 LS / LF 계산
     *
     * 원칙:
     * - 후행이 없는 마지막 작업은 LF = 프로젝트 총기간
     * - 후행이 여러 개면, 그중 가장 빡빡한(가장 작은) 제한을 따라야 한다.
     */
    const reversed = [...sorted].reverse();

    for (const node of reversed) {
        const duration = parseDurationDays(node.row.durationDays, `작업 ${node.key}`);

        /**
         * 후행이 없는 끝 작업
         * -> 프로젝트 종료시점에 맞춰 LF / LS를 결정
         */
        if (node.successors.length === 0) {
            node.lf = projectDuration;
            node.ls = projectDuration - duration;
            continue;
        }

        /**
         * 후행작업들로부터 들어오는 제한값들
         *
         * latestStartLimit  : 현재 작업의 LS 상한
         * latestFinishLimit : 현재 작업의 LF 상한
         */
        let latestStartLimit = INF;
        let latestFinishLimit = INF;
        let hasStartLimit = false;
        let hasFinishLimit = false;

        for (const sdep of node.successors) {
            const succ = nodeMap.get(sdep.code);
            if (!succ) continue;

            const [candLS, candLF] = backwardConstraintLimits(succ, sdep.rel, sdep.lag);

            // LS 제한이 있다면 가장 작은 값(가장 빡빡한 제한)을 사용
            if (candLS < INF) {
                hasStartLimit = true;
                if (candLS < latestStartLimit) latestStartLimit = candLS;
            }

            // LF 제한이 있다면 가장 작은 값(가장 빡빡한 제한)을 사용
            if (candLF < INF) {
                hasFinishLimit = true;
                if (candLF < latestFinishLimit) latestFinishLimit = candLF;
            }
        }

        let finalLS: number;
        let finalLF: number;

        /**
         * 후행들로부터 어떤 제한도 안 들어온 경우
         * -> 프로젝트 종료시점 기준으로 계산
         */
        if (!hasStartLimit && !hasFinishLimit) {
            finalLF = projectDuration;
            finalLS = projectDuration - duration;

            /**
             * LF 제한만 있는 경우
             * -> LF를 먼저 정하고 LS는 duration으로 역산
             */
        } else if (hasFinishLimit && !hasStartLimit) {
            finalLF = latestFinishLimit;
            finalLS = finalLF - duration;

            /**
             * LS 제한만 있는 경우
             * -> LS를 먼저 정하고 LF는 duration으로 계산
             */
        } else if (hasStartLimit && !hasFinishLimit) {
            finalLS = latestStartLimit;
            finalLF = finalLS + duration;

            /**
             * LS 제한과 LF 제한이 둘 다 있는 경우
             * -> 두 제한을 동시에 만족하도록 보정
             */
        } else {
            finalLS = latestStartLimit;

            // 현재 LS로 두면 LF 제한을 넘길 수 있으므로 보정
            if ((latestFinishLimit - duration) < finalLS) {
                finalLS = latestFinishLimit - duration;
            }

            finalLF = finalLS + duration;

            // 혹시 계산 후 LF가 제한을 넘으면 다시 LF 기준으로 보정
            if (finalLF > latestFinishLimit) {
                finalLF = latestFinishLimit;
                finalLS = finalLF - duration;
            }
        }

        node.ls = finalLS;
        node.lf = finalLF;
    }

    /**
     * [8] Float / Critical 계산
     *
     * TF = LS - ES
     * FF = computeFreeFloat(...)
     * critical path 여부 = TF === 0
     */
    for (const node of sorted) {
        node.tf = node.ls - node.es;
        node.ff = computeFreeFloat(node, nodeMap);
        node.isCritical = node.tf === 0;
    }

    /**
     * [9] 계산 결과를 원본 rows에 다시 반영
     *
     * CPM 대상이 아니었던 row는 그대로 돌려주고,
     * nodeMap에 존재하는 row만 계산값을 덮어쓴다.
     */
    return rows.map(row => {
        const key = row.wbsCode ? normalizeWbsCode(row.wbsCode) : undefined;
        const node = key ? nodeMap.get(key) : undefined;

        // CPM 계산 대상이 아니면 원본 그대로 반환
        if (!node) return row;

        // 계산 결과 반영
        return {
            ...row,
            es: node.es,
            ef: node.ef,
            ls: node.ls,
            lf: node.lf,
            tf: node.tf,
            ff: node.ff,
            isCritical: node.isCritical,
        };
    });
}
