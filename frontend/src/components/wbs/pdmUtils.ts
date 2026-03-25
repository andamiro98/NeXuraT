import type { EditableWbsRow } from "./types";

const INF = Math.floor(Number.MAX_SAFE_INTEGER / 4);

const toNum = (v: string | number | null | undefined): number => {
    if (v == null || v === "") return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isNaN(n) ? 0 : n;
};

interface Dependency {
    code: string;
    rel: "FS" | "SS" | "FF" | "SF";
    lag: number;
}

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

function parseDependency(token: string): Dependency {
    const normalized = token.trim().toUpperCase();
    const pattern = /^(.+?)(FS|SS|FF|SF)([+-]\d+)?$/;
    const m = normalized.match(pattern);

    if (m) {
        const code = m[1].trim();
        const rel = m[2] as Dependency["rel"];
        const lag = m[3] ? parseInt(m[3], 10) : 0;
        if (!code) throw new Error(`Missing predecessor code in token: ${token}`);
        return { code, rel, lag };
    }

    const codeOnly = normalized.trim();
    if (codeOnly) return { code: codeOnly, rel: "FS", lag: 0 };

    throw new Error(`Invalid dependency token: ${token}`);
}

function parseRelationValues(value: unknown): Dependency["rel"][] {
    // 필터링하지 않고 인덱스가 유지되도록 원소를 개수를 보장한다.
    // 비어 있거나 유효하지 않은 값은 기본값("FS")을 전달.
    return String(value ?? "")
        .split(",")
        .map(v => {
            const u = v.trim().toUpperCase();
            if (u === "FS" || u === "SS" || u === "FF" || u === "SF") return u as Dependency["rel"];
            return "FS" as Dependency["rel"]; // 빈 값 또는 잘못된 값은 기본값
        });
}

function parseLagValues(value: unknown): number[] {
    return String(value ?? "")
        .split(",")
        .map(v => v.trim())
        .filter(v => v !== "")
        .map(v => {
            const n = parseInt(v, 10);
            return Number.isNaN(n) ? 0 : n;
        });
}

function forwardConstraint(pred: ActivityNode, succ: ActivityNode, rel: Dependency["rel"], lag: number): number {
    const dur = toNum(succ.row.durationDays);
    switch (rel) {
        case "FS": return pred.ef + lag;
        case "SS": return pred.es + lag;
        case "FF": return pred.ef + lag - dur;
        case "SF": return pred.es + lag - dur;
    }
}

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

function computeFreeFloat(node: ActivityNode, nodeMap: Map<string, ActivityNode>): number {
    if (node.successors.length === 0) return 0;

    let minSlack = INF;

    for (const sdep of node.successors) {
        const succ = nodeMap.get(sdep.code);
        if (!succ) continue;

        let slack = 0; // 불변식으로 기본값 설정
        switch (sdep.rel) {
            case "FS": slack = succ.es - (node.ef + sdep.lag); break;
            case "SS": slack = succ.es - (node.es + sdep.lag); break;
            case "FF": slack = succ.ef - (node.ef + sdep.lag); break;
            case "SF": slack = succ.ef - (node.es + sdep.lag); break;
        }

        if (slack < minSlack) minSlack = slack;
    }

    return minSlack >= INF ? 0 : minSlack;
}

function topologicalSort(nodeMap: Map<string, ActivityNode>): ActivityNode[] {
    const inDegree = new Map<string, number>();

    for (const key of nodeMap.keys()) inDegree.set(key, 0);
    for (const node of nodeMap.values()) inDegree.set(node.key, node.predecessors.length);

    const queue: ActivityNode[] = [];
    for (const [key, deg] of inDegree.entries()) {
        if (deg === 0) queue.push(nodeMap.get(key)!);
    }

    const result: ActivityNode[] = [];

    while (queue.length > 0) {
        const current = queue.shift()!;
        result.push(current);

        for (const sdep of current.successors) {
            const newDeg = (inDegree.get(sdep.code) ?? 1) - 1;
            inDegree.set(sdep.code, newDeg);
            if (newDeg === 0) {
                const next = nodeMap.get(sdep.code);
                if (next) queue.push(next);
            }
        }
    }

    return result;
}

export function calculateCpm(rows: EditableWbsRow[]): EditableWbsRow[] {
    const eligible = rows.filter(r =>
        r.wbsCode &&
        r.hasChildren === false &&
        r.durationDays != null &&
        String(r.durationDays).trim() !== ""
    );

    const nodeMap = new Map<string, ActivityNode>();

    for (const row of eligible) {
        const key = row.wbsCode.trim().toUpperCase();

        if (nodeMap.has(key)) continue;

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

    for (const node of nodeMap.values()) {
        const predCodeRaw = node.row.predecessorCode;
        if (!predCodeRaw || !predCodeRaw.trim()) continue;

        const predCodes = predCodeRaw.split(",").map(s => s.trim()).filter(Boolean);
        const relTypes = parseRelationValues(node.row.relationType);
        const lagValues = parseLagValues(node.row.lag);

        for (let i = 0; i < predCodes.length; i++) {
            const token = predCodes[i];

            let dep: Dependency;
            try {
                dep = parseDependency(token);
            } catch {
                continue;
            }

            const hasEmbeddedRel = /^.+(FS|SS|FF|SF)([+-]\d+)?$/i.test(token);

            if (!hasEmbeddedRel) {
                const rel = relTypes[i] || relTypes[0] || "FS";
                const lag = lagValues[i] ?? lagValues[0] ?? 0;
                dep = { code: dep.code, rel, lag };
            }

            const predNode = nodeMap.get(dep.code.toUpperCase());
            if (!predNode) continue;

            node.predecessors.push(dep);
            predNode.successors.push({
                code: node.key,
                rel: dep.rel,
                lag: dep.lag,
            });
        }
    }

    const sorted = topologicalSort(nodeMap);
    if (sorted.length !== nodeMap.size) {
        throw new Error("CPM 계산 오류: 선행관계에 순환(cycle)이 감지되었습니다.");
    }

    for (const node of sorted) {
        let esVal = 0;

        for (const dep of node.predecessors) {
            const pred = nodeMap.get(dep.code.toUpperCase());
            if (!pred) continue;

            const cand = forwardConstraint(pred, node, dep.rel, dep.lag);
            if (cand > esVal) esVal = cand;
        }

        node.es = esVal;
        node.ef = node.es + toNum(node.row.durationDays);
    }

    let projectDuration = 0;
    for (const node of nodeMap.values()) {
        if (node.ef > projectDuration) projectDuration = node.ef;
    }

    const reversed = [...sorted].reverse();

    for (const node of reversed) {
        const duration = toNum(node.row.durationDays);

        if (node.successors.length === 0) {
            node.lf = projectDuration;
            node.ls = projectDuration - duration;
            continue;
        }

        let latestStartLimit = INF;
        let latestFinishLimit = INF;
        let hasStartLimit = false;
        let hasFinishLimit = false;

        for (const sdep of node.successors) {
            const succ = nodeMap.get(sdep.code);
            if (!succ) continue;

            const [candLS, candLF] = backwardConstraintLimits(succ, sdep.rel, sdep.lag);

            if (candLS < INF) {
                hasStartLimit = true;
                if (candLS < latestStartLimit) latestStartLimit = candLS;
            }

            if (candLF < INF) {
                hasFinishLimit = true;
                if (candLF < latestFinishLimit) latestFinishLimit = candLF;
            }
        }

        let finalLS: number;
        let finalLF: number;

        if (!hasStartLimit && !hasFinishLimit) {
            finalLF = projectDuration;
            finalLS = projectDuration - duration;
        } else if (hasFinishLimit && !hasStartLimit) {
            finalLF = latestFinishLimit;
            finalLS = finalLF - duration;
        } else if (hasStartLimit && !hasFinishLimit) {
            finalLS = latestStartLimit;
            finalLF = finalLS + duration;
        } else {
            finalLS = latestStartLimit;

            if ((latestFinishLimit - duration) < finalLS) {
                finalLS = latestFinishLimit - duration;
            }

            finalLF = finalLS + duration;

            if (finalLF > latestFinishLimit) {
                finalLF = latestFinishLimit;
                finalLS = finalLF - duration;
            }
        }

        node.ls = finalLS;
        node.lf = finalLF;
    }

    for (const node of sorted) {
        node.tf = node.ls - node.es;
        node.ff = computeFreeFloat(node, nodeMap);
        node.isCritical = node.tf === 0;
    }

    return rows.map(row => {
        const key = row.wbsCode?.trim().toUpperCase();
        const node = key ? nodeMap.get(key) : undefined;

        if (!node) return row;

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