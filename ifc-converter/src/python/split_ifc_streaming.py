#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
# Windows cp949 콘솔 → UTF-8 강제
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

"""
split_ifc_streaming.py

ifcopenshell.open() 없이 4GB+ IFC 파일을 스트리밍으로 분할.
멀티라인 엔티티도 올바르게 처리.

Pass 1 : 스트리밍 스캔 → 헤더/푸터/글로벌 엔티티 수집, 인덱스 구축
Pass 2 : 층별 BFS 클로저 (층 정보 없으면 크기 기반 분할)
Pass 3 : 단일 선형 패스 → 청크 파일 동시 출력

실행:
 py src/python/split_ifc_streaming.py <IFC 경로> <OUTPUT 경로> 800
"""

import os
import re
import time
from collections import defaultdict, deque

ENTITY_RE = re.compile(r'^#(\d+)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*\(')
REF_RE    = re.compile(r'#(\d+)')

GLOBAL_TYPES = frozenset({
    'IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY',
    'IFCOWNERHISTORY', 'IFCORGANIZATION', 'IFCAPPLICATION',
    'IFCPERSON', 'IFCPERSONANDORGANIZATION',
    'IFCGEOMETRICREPRESENTATIONCONTEXT', 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
    'IFCUNITASSIGNMENT', 'IFCSIUNIT', 'IFCCONVERSIONBASEDUNIT',
    'IFCDIMENSIONALEXPONENTS', 'IFCMEASUREWITHUNIT',
    'IFCRELAGGREGATES', 'IFCRELCONTAINEDINSPATIALSTRUCTURE',
    'IFCRELDEFINESBYPROPERTIES', 'IFCPROPERTYSET',
    'IFCRELDEFINESBYTYPE',
})


def fmt_mb(n): return f"{n / 1_048_576:.1f} MB"
def fmt_t(s):
    m = int(s // 60)
    return f"{m}m {s%60:.0f}s" if m else f"{s:.1f}s"


# ──────────────────────────────────────────────────────────────
# Pass 1: 멀티라인 엔티티 처리 및 실제 바이트 크기 계산
# ──────────────────────────────────────────────────────────────
def pass1(ifc_path, total_bytes):
    t0 = time.time()
    print("-- Pass 1: 엔티티 인덱스 구축 및 크기 계산 중...")

    header_lines   = []
    footer_lines   = []
    global_lines   = []
    type_map       = {}
    ref_map        = {}
    entity_sizes   = {}   # eid -> bytes
    storey_ids     = []
    storey_contain = defaultdict(list)

    in_header  = True
    in_data    = False
    scanned    = 0
    last_log   = 0
    n_entities = 0

    # 멀티라인 엔티티 누적
    buf_lines    = []
    buf_start_scanned = 0
    in_entity    = False

    def flush(lines, start_scanned, current_scanned):
        nonlocal n_entities
        full = ' '.join(l.strip() for l in lines)
        m = ENTITY_RE.match(full)
        if not m:
            return
        eid   = int(m.group(1))
        etype = m.group(2).upper()
        type_map[eid] = etype
        
        # 실제 바이트 크기 기록
        size = current_scanned - start_scanned
        entity_sizes[eid] = size
        n_entities += 1

        if etype in GLOBAL_TYPES:
            global_lines.extend(lines)
            if etype == 'IFCBUILDINGSTOREY':
                storey_ids.append(eid)
            elif etype == 'IFCRELCONTAINEDINSPATIALSTRUCTURE':
                all_refs = [int(x) for x in REF_RE.findall(full)]
                if len(all_refs) >= 3:
                    storey_ref   = all_refs[-1]
                    element_refs = all_refs[2:-1]
                    storey_contain[storey_ref].extend(element_refs)
                    print(f"  [containment] storey=#{storey_ref}, {len(element_refs):,}개 요소")
        else:
            refs = [int(x) for x in REF_RE.findall(full)]
            if refs:
                ref_map[eid] = refs

    with open(ifc_path, 'rb') as f:
        for raw in f:
            line_len = len(raw)
            line     = raw.decode('utf-8', errors='replace')
            stripped = line.strip()
            
            if in_header:
                header_lines.append(line)
                scanned += line_len
                if stripped == 'DATA;':
                    in_header = False
                    in_data   = True
                continue

            if in_data:
                if stripped.startswith('ENDSEC;'):
                    if in_entity and buf_lines:
                        flush(buf_lines, buf_start_scanned, scanned)
                        buf_lines = []
                        in_entity = False
                    in_data = False
                    footer_lines.append(line)
                    scanned += line_len
                    continue

                if ENTITY_RE.match(stripped):
                    if in_entity and buf_lines:
                        flush(buf_lines, buf_start_scanned, scanned)
                    buf_start_scanned = scanned
                    buf_lines = [line]
                    in_entity = True
                elif in_entity:
                    buf_lines.append(line)
                    if stripped.endswith(';'):
                        scanned += line_len # 현재 라인까지 포함해서 flush
                        flush(buf_lines, buf_start_scanned, scanned)
                        buf_lines = []
                        in_entity = False
                        continue # 이미 scanned 더했으므로
                
                scanned += line_len
            else:
                footer_lines.append(line)
                scanned += line_len

            step = scanned // (256 * 1_048_576)
            if step != last_log:
                last_log = step
                pct = scanned / total_bytes * 100
                print(f"  {fmt_mb(scanned)} / {fmt_mb(total_bytes)} ({pct:.0f}%)"
                      f"  entities={n_entities:,}  {fmt_t(time.time()-t0)}")

    global_size = sum(entity_sizes.get(eid, 0) for eid, et in type_map.items() if et in GLOBAL_TYPES)
    overhead_size = len(''.join(header_lines).encode('utf-8')) + global_size + len(''.join(footer_lines).encode('utf-8'))
    
    print(f"  완료: entities={n_entities:,}, global_size={fmt_mb(global_size)}, overhead={fmt_mb(overhead_size)}")
    print(f"  소요: {fmt_t(time.time()-t0)}\n")
    return (
        ''.join(header_lines), ''.join(footer_lines), ''.join(global_lines),
        type_map, ref_map, entity_sizes, storey_ids, storey_contain, overhead_size
    )


# ──────────────────────────────────────────────────────────────
# Pass 2: BFS 클로저 → 실제 바이트 크기 기반 청크 할당
# ──────────────────────────────────────────────────────────────
def assign_chunks(type_map, ref_map, entity_sizes, storey_ids, storey_contain, target_bytes, overhead_size):
    print("-- Pass 2: 청크 할당 계산 중 (실제 바이트 기준)...")
    t0 = time.time()

    global_ids = frozenset(eid for eid, et in type_map.items() if et in GLOBAL_TYPES)
    entity_chunk = {eid: -1 for eid in global_ids}  # -1 = global (always included)
    initial_chunks = []

    def bfs(seeds):
        visited = set()
        q = deque(seeds)
        while q:
            eid = q.popleft()
            if eid in visited or eid in global_ids:
                continue
            visited.add(eid)
            for r in ref_map.get(eid, []):
                if r not in visited and r not in global_ids:
                    q.append(r)
        return visited

    # ---------- 1단계: 논리적 덩어리(층) 생성 ----------
    if storey_ids and any(storey_contain.values()):
        print(f"  층 기반 분할 시도: {len(storey_ids)}층")
        for i, sid in enumerate(storey_ids):
            elems = storey_contain.get(sid, [])
            closure = bfs(elems)
            initial_chunks.append(closure)
            print(f"  층 {i+1}: 직접요소={len(elems):,}  클로저={len(closure):,}")

        unassigned = [eid for eid in type_map if eid not in global_ids]
        for c in initial_chunks:
            unassigned = [eid for eid in unassigned if eid not in c]
        
        if unassigned:
            initial_chunks.append(set(unassigned))
            print(f"  미분류 {len(unassigned):,}개 추가")
    else:
        print(f"  층 정보 부족 → 전체 데이터 기반 분할")
        initial_chunks.append(set(eid for eid in type_map if eid not in global_ids))

    # ---------- 2단계: 실제 바이트 크기 기준으로 조각내기 ----------
    final_chunks = []
    # 각 청크가 가질 수 있는 순수 엔티티 데이터 한계 (오버헤드 제외)
    # 안전을 위해 오버헤드의 1.2배를 뺌 (멀티라인 합치기 등 여유분)
    effective_limit = target_bytes - (overhead_size * 1.1)
    if effective_limit < 100 * 1024 * 1024:
        # 오버헤드가 너무 크면 최소 100MB는 할당
        effective_limit = 100 * 1024 * 1024

    for chunk in initial_chunks:
        if not chunk: continue
        
        # ID 순서대로 정렬하여 연속성 유지
        sorted_ids = sorted(list(chunk))
        cur_set = set()
        cur_size = 0
        
        for eid in sorted_ids:
            esize = entity_sizes.get(eid, 0)
            if cur_size + esize > effective_limit and cur_set:
                final_chunks.append(cur_set)
                cur_set = set()
                cur_size = 0
            
            cur_set.add(eid)
            cur_size += esize
        
        if cur_set:
            final_chunks.append(cur_set)

    # 인덱스 재할당
    for ci, cset in enumerate(final_chunks):
        for eid in cset:
            entity_chunk[eid] = ci

    print(f"  최종 청크 수: {len(final_chunks)}, 소요: {fmt_t(time.time()-t0)}\n")
    return entity_chunk, len(final_chunks)



# ──────────────────────────────────────────────────────────────
# Pass 3: 단일 선형 패스 → 청크 파일 동시 출력
# ──────────────────────────────────────────────────────────────
def write_chunks(ifc_path, out_dir, total_bytes,
                 header_text, footer_text, global_text,
                 entity_chunk, n_chunks):
    print("-- Pass 3: 청크 파일 생성 중...")
    t0 = time.time()

    chunk_paths = [os.path.join(out_dir, f"chunk_{i+1:03d}.ifc") for i in range(n_chunks)]
    chunk_files = []
    for p in chunk_paths:
        fh = open(p, 'w', encoding='utf-8')
        fh.write(header_text)
        fh.write(global_text)
        chunk_files.append(fh)

    in_header = True
    in_data   = False
    scanned   = 0
    last_log  = 0
    written   = 0

    # 멀티라인 엔티티 누적
    buf_lines = []
    buf_eid   = None
    in_entity = False

    def write_entity(lines, eid):
        nonlocal written
        ci = entity_chunk.get(eid)
        if ci is not None and ci >= 0:
            for l in lines:
                chunk_files[ci].write(l)
            written += 1

    with open(ifc_path, 'rb') as f:
        for raw in f:
            scanned += len(raw)
            line     = raw.decode('utf-8', errors='replace')
            stripped = line.strip()

            if in_header:
                if stripped == 'DATA;':
                    in_header = False
                    in_data   = True
                continue

            if in_data:
                if stripped.startswith('ENDSEC;'):
                    if in_entity and buf_lines and buf_eid is not None:
                        write_entity(buf_lines, buf_eid)
                        buf_lines = []
                        buf_eid   = None
                        in_entity = False
                    in_data = False
                    continue

                m = ENTITY_RE.match(stripped)
                if m:
                    if in_entity and buf_lines and buf_eid is not None:
                        write_entity(buf_lines, buf_eid)
                    buf_eid   = int(m.group(1))
                    buf_lines = [line]
                    in_entity = True
                elif in_entity:
                    buf_lines.append(line)
                    if stripped.endswith(';'):
                        if buf_eid is not None:
                            write_entity(buf_lines, buf_eid)
                        buf_lines = []
                        buf_eid   = None
                        in_entity = False

            step = scanned // (256 * 1_048_576)
            if step != last_log:
                last_log = step
                pct = scanned / total_bytes * 100
                print(f"  {fmt_mb(scanned)} / {fmt_mb(total_bytes)} ({pct:.0f}%)"
                      f"  written={written:,}  {fmt_t(time.time()-t0)}")

    for fh in chunk_files:
        fh.write(footer_text)
        fh.close()

    print(f"  소요: {fmt_t(time.time()-t0)}\n")
    return chunk_paths


# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 3:
        print(f"사용법: py {sys.argv[0]} <ifc_path> <output_dir> [target_mb=800]")
        sys.exit(1)

    ifc_path     = sys.argv[1]
    out_dir      = sys.argv[2]
    target_mb    = int(sys.argv[3]) if len(sys.argv) > 3 else 800
    target_bytes = target_mb * 1_048_576

    if not os.path.exists(ifc_path):
        print(f"ERROR: 파일 없음: {ifc_path}")
        sys.exit(1)

    os.makedirs(out_dir, exist_ok=True)
    total_bytes = os.path.getsize(ifc_path)
    sep = "=" * 55

    print(sep)
    print(f"  split_ifc_streaming.py")
    print(f"  파일 : {os.path.basename(ifc_path)}")
    print(f"  크기 : {fmt_mb(total_bytes)}")
    print(f"  목표 : {target_mb} MB / 청크")
    print(f"  출력 : {out_dir}")
    print(sep + "\n")

    t_all = time.time()

    (header, footer, global_text,
     type_map, ref_map, entity_sizes,
     storey_ids, storey_contain, overhead_size) = pass1(ifc_path, total_bytes)

    entity_chunk, n_chunks = assign_chunks(
        type_map, ref_map, entity_sizes, storey_ids, storey_contain, target_bytes, overhead_size)

    chunk_paths = write_chunks(
        ifc_path, out_dir, total_bytes,
        header, footer, global_text,
        entity_chunk, n_chunks)

    print(sep)
    print(f"  완료! 총 소요: {fmt_t(time.time()-t_all)}")
    print(f"  생성 청크: {n_chunks}개")
    for p in chunk_paths:
        print(f"    {os.path.basename(p)}: {fmt_mb(os.path.getsize(p))}")
    print(sep)

    print(f"RESULT_FILES:{'|'.join(chunk_paths)}")


if __name__ == '__main__':
    main()
