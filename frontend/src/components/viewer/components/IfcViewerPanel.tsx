import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";

type IfcViewerPanelProps = {
    height?: number | string;
};

// ================= Properties Rendering Helpers =================
const formatValue = (value: unknown): string => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value, null, 2);
};

const isAttribute = (value: any): boolean => !!value && "value" in value;

const getAttributeValue = (data: any, key: string) => {
    const entry = data?.[key];
    if (!entry || Array.isArray(entry) || !isAttribute(entry)) return undefined;
    return entry.value;
};

const getDisplayName = (data: any, fallback: string) => {
    const value = getAttributeValue(data, "Name");
    return value === undefined ? fallback : String(value);
};

const unwrapPropertyValue = (value: any, seen = new WeakSet<object>()): string => {
    if (!value) return "";
    if (isAttribute(value)) return formatValue(value.value);
    if (typeof value !== "object") return formatValue(value);
    if (seen.has(value)) return "[cyclic]";
    seen.add(value);

    const directKeys = ["NominalValue", "Value", "Description", "_value", "value"];
    for (const key of directKeys) {
        const entry = value[key];
        if (!entry || Array.isArray(entry)) continue;
        const unwrapped = unwrapPropertyValue(entry, seen);
        if (unwrapped) return unwrapped;
    }

    for (const [, entry] of Object.entries(value)) {
        if (Array.isArray(entry)) continue;
        const unwrapped = unwrapPropertyValue(entry, seen);
        if (unwrapped) return unwrapped;
    }

    return "";
};

const getSingleEntry = (value: any) => {
    if (!value) return undefined;
    return Array.isArray(value) ? value[0] : value;
};

function BasicAttributesView({ data }: { data: any }) {
    const preferredKeys = [
        "_category",
        "_localId",
        "_guid",
        "Name",
        "ObjectType",
        "LongName",
        "Description",
        "Tag",
    ];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {preferredKeys.map((key) => {
                const val = getAttributeValue(data, key);
                if (val === undefined) return null;

                return (
                    <div
                        key={key}
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            borderBottom: "1px solid #f3f4f6",
                            paddingBottom: 4,
                            gap: 8,
                        }}
                    >
                        <span style={{ fontWeight: 600, color: "#4b5563", fontSize: 12 }}>
                            {key}
                        </span>
                        <span style={{ color: "#111827", fontSize: 12, textAlign: "right" }}>
                            {formatValue(val)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

function PropertySetsView({ data }: { data: any }) {
    const definitions = data?.IsDefinedBy;
    if (!definitions || !Array.isArray(definitions) || definitions.length === 0) {
        return null;
    }

    const sets = definitions.filter(
        (item) => getAttributeValue(item, "_category") === "IFCPROPERTYSET"
    );

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            <strong
                style={{
                    fontSize: 13,
                    borderBottom: "1px solid #e5e7eb",
                    paddingBottom: 4,
                }}
            >
                Property Sets
            </strong>

            {sets.map((pset, index) => {
                const name = getDisplayName(pset, `Property Set ${index + 1}`);
                const propertiesList = pset.HasProperties;

                return (
                    <details key={index} style={{ fontSize: 12 }} open>
                        <summary
                            style={{
                                fontWeight: 600,
                                cursor: "pointer",
                                marginBottom: 4,
                            }}
                        >
                            {name}
                        </summary>

                        <div
                            style={{
                                paddingLeft: 8,
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                            }}
                        >
                            {!propertiesList ||
                            !Array.isArray(propertiesList) ||
                            propertiesList.length === 0 ? (
                                <span style={{ color: "#6b7280" }}>No properties found</span>
                            ) : (
                                propertiesList.map((prop: any, idx: number) => {
                                    const propName = getDisplayName(prop, "Unnamed property");
                                    const nominalValue = getSingleEntry(prop?.NominalValue);
                                    const unitValue = getSingleEntry(prop?.Unit);
                                    const primaryUnitValue = getSingleEntry(prop?.PrimaryUnit);

                                    const propValue =
                                        unwrapPropertyValue(nominalValue) ||
                                        unwrapPropertyValue(prop) ||
                                        "-";

                                    const unit =
                                        unwrapPropertyValue(unitValue) ||
                                        unwrapPropertyValue(primaryUnitValue) ||
                                        "";

                                    return (
                                        <div
                                            key={idx}
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                borderBottom: "1px solid #f3f4f6",
                                                gap: 8,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    color: "#4b5563",
                                                    flex: 1,
                                                    paddingRight: 8,
                                                }}
                                            >
                                                {propName}
                                            </span>
                                            <span
                                                style={{
                                                    color: "#111827",
                                                    flex: 1,
                                                    textAlign: "right",
                                                    wordBreak: "break-all",
                                                }}
                                            >
                                                {propValue} {unit}
                                            </span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </details>
                );
            })}
        </div>
    );
}

export default function IfcViewerPanel({ height = 360 }: IfcViewerPanelProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const componentsRef = useRef<any>(null);
    const ifcLoaderRef = useRef<any>(null);
    const currentModelRef = useRef<any>(null);
    const currentFileNameRef = useRef<string>("");

    const [status, setStatus] = useState("뷰어 초기화 중...");
    const [isReady, setIsReady] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedProperties, setSelectedProperties] = useState<any>(null);
    const [hasDownloadableFrag, setHasDownloadableFrag] = useState(false);

    const downloadCurrentFrag = async () => {
        const model = currentModelRef.current;
        const sourceFileName = currentFileNameRef.current || "model.ifc";

        if (!model) {
            setStatus("다운로드할 모델이 없습니다.");
            return;
        }

        if (typeof model.getBuffer !== "function") {
            setStatus("현재 모델은 .frag 다운로드를 지원하지 않습니다.");
            return;
        }

        try {
            setStatus("FRAG 파일 생성 중...");
            const fragsBuffer = await model.getBuffer(false);

            const fragFileName = sourceFileName.replace(/\.(ifc|frag)$/i, "") + ".frag";
            const file = new File([fragsBuffer], fragFileName, {
                type: "application/octet-stream",
            });

            const url = URL.createObjectURL(file);
            const link = document.createElement("a");
            link.href = url;
            link.download = file.name;
            link.style.display = "none";

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            window.setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 1000);

            setStatus(`${fragFileName} 다운로드 완료`);
        } catch (error) {
            console.error("FRAG download error:", error);
            setStatus("FRAG 다운로드 실패");
        }
    };

    useEffect(() => {
        let mounted = true;

        const setupViewer = async () => {
            if (!containerRef.current) return;

            const components = new OBC.Components();
            componentsRef.current = components;

            const worlds = components.get(OBC.Worlds);
            const world = worlds.create<
                OBC.SimpleScene,
                OBC.OrthoPerspectiveCamera,
                OBC.SimpleRenderer
            >();

            world.scene = new OBC.SimpleScene(components);
            world.scene.setup();
            world.scene.three.background = null;

            world.renderer = new OBC.SimpleRenderer(components, containerRef.current);
            world.camera = new OBC.OrthoPerspectiveCamera(components);

            await world.camera.controls.setLookAt(12, 12, 12, 0, 0, 0);
            world.camera.controls.infinityDolly = true;
            world.camera.controls.dollyToCursor = true;

            components.init();

            const fragments = components.get(OBC.FragmentsManager);

            const workerUrl = new URL("./thatopen/worker.mjs?v=20260406", window.location.href).toString();
            const wasmPath = new URL("./thatopen/", window.location.href).toString();

            fragments.init(workerUrl);

            world.camera.controls.addEventListener("update", () => {
                fragments.core.update();
            });

            fragments.list.onItemSet.add(({ value: model }: any) => {
                model.useCamera(world.camera.three);
                world.scene.three.add(model.object);
                fragments.core.update(true);
            });

            fragments.core.models.materials.list.onItemSet.add(
                ({ value: material }: any) => {
                    if (!("isLodMaterial" in material && material.isLodMaterial)) {
                        material.polygonOffset = true;
                        material.polygonOffsetUnits = 1;
                        material.polygonOffsetFactor = 1;
                    }
                }
            );

            const ifcLoader = components.get(OBC.IfcLoader);
            const casters = components.get(OBC.Raycasters);
            const caster = casters.get(world);

            const handleCanvasDoubleClick = async (event: globalThis.MouseEvent) => {
                if (!containerRef.current || !world.renderer) return;

                const rect = containerRef.current.getBoundingClientRect();
                const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
                const mouse = new THREE.Vector2(x, y);

                const result = (await caster.castRay({ position: mouse })) as any;
                const modelId = result?.fragments?.modelId;

                let hitLocalId: number | null = null;
                let hitModel: any = null;

                if (result && modelId) {
                    hitLocalId = result.localId;
                    hitModel = fragments.list.get(modelId);
                }

                for (const model of fragments.list.values()) {
                    await (model as any).resetColor(undefined);
                }

                if (hitModel && hitLocalId !== null) {
                    const modelIdMap = {
                        [hitModel.modelId]: new Set([hitLocalId]),
                    };

                    await hitModel.setColor([hitLocalId], new THREE.Color("#f97316"));

                    try {
                        const dataByModel = await fragments.getData(modelIdMap, {
                            attributesDefault: true,
                            relations: {
                                IsDefinedBy: { attributes: true, relations: true },
                                HasProperties: { attributes: true, relations: false },
                            },
                        });

                        const itemDataArr = dataByModel[hitModel.modelId];
                        console.log("itemDataArr :" , itemDataArr)
                        if (itemDataArr && itemDataArr.length > 0) {
                            setSelectedProperties(itemDataArr[0]);
                        } else {
                            setSelectedProperties({
                                _localId: hitLocalId,
                                message: "속성 정보가 없습니다.",
                            });
                        }
                    } catch (err) {
                        setSelectedProperties({
                            error: "속성 조회 실패",
                            _localId: hitLocalId,
                        });
                    }
                } else {
                    setSelectedProperties(null);
                }

                await fragments.core.update(true);
            };

            const handleCanvasSingleClick = async (event: globalThis.MouseEvent) => {
                if (!containerRef.current || !world.renderer) return;

                const rect = containerRef.current.getBoundingClientRect();
                const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
                const mouse = new THREE.Vector2(x, y);

                const result = (await caster.castRay({ position: mouse })) as any;

                if (!result || !result.fragments?.modelId) {
                    for (const model of fragments.list.values()) {
                        await (model as any).resetColor(undefined);
                    }

                    setSelectedProperties(null);
                    await fragments.core.update(true);
                }
            };

            containerRef.current.addEventListener("dblclick", handleCanvasDoubleClick);
            containerRef.current.addEventListener("click", handleCanvasSingleClick);

            ifcLoaderRef.current = ifcLoader;

            await ifcLoader.setup({
                autoSetWasm: false,
                wasm: {
                    path: wasmPath,
                    absolute: true,
                },
            });

            if (!mounted) return;

            setIsReady(true);
            setStatus("IFC 또는 FRAG 파일을 선택하세요.");
        };

        setupViewer().catch((error) => {
            console.error("That Open viewer init error:", error);
            if (mounted) {
                setStatus("뷰어 초기화 실패. 콘솔 로그를 확인하세요.");
            }
        });

        return () => {
            mounted = false;

            const components = componentsRef.current;
            if (components?.dispose) {
                components.dispose();
            }
        };
    }, []);

    const handleIfcUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        const components = componentsRef.current;

        if (!file || !ifcLoaderRef.current || !components) return;

        const fragments = components.get(OBC.FragmentsManager);
        const isFrag = file.name.toLowerCase().endsWith(".frag");

        setIsLoading(true);
        setHasDownloadableFrag(false);
        setSelectedProperties(null);
        setStatus(`${file.name} 로딩 중...`);

        try {
            const data = await file.arrayBuffer();
            const buffer = new Uint8Array(data);

            let model: any = null;

            if (isFrag) {
                model = await fragments.core.load(buffer, { modelId: file.name });
                currentModelRef.current = model;
                currentFileNameRef.current = file.name;
                setHasDownloadableFrag(true);
                setStatus(`${file.name} FRAG 로드 완료`);
            } else {
                model = await ifcLoaderRef.current.load(buffer, false, file.name, {
                    processData: {
                        progressCallback: (progress: number) => {
                            const percent = progress > 1 ? progress : progress * 100;
                            setStatus(`${file.name} 변환 중... ${Math.round(percent)}%`);
                        },
                    },
                });

                // load() 반환값이 비어 있는 경우를 대비한 fallback
                const loadedModel =
                    model ??
                    Array.from(fragments.list.values())[Array.from(fragments.list.values()).length - 1];

                if (!loadedModel) {
                    throw new Error("변환된 Fragments 모델을 찾을 수 없습니다.");
                }

                currentModelRef.current = loadedModel;
                currentFileNameRef.current = file.name;
                setHasDownloadableFrag(true);

                setStatus(`${file.name} 로드 완료 / .frag 다운로드 시작 중...`);
                await downloadCurrentFrag();
            }

            const worlds = components.get(OBC.Worlds);
            const world = Array.from(worlds.list.values())[0] as any;
            if (world && world.camera && world.camera.controls) {
                await world.camera.controls.fitToSphere(world.scene.three, true);
            }
        } catch (error) {
            console.error("Model load error:", error);
            setStatus(`${file.name} 로딩 실패`);
        } finally {
            setIsLoading(false);
            e.target.value = "";
        }
    };

    return (
        <div
            style={{
                height,
                minHeight: 280,
                display: "flex",
                flexDirection: "column",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                overflow: "hidden",
                background: "#fff",
            }}
        >
            <div
                style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid #e5e7eb",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 15 }}>IFC Viewer</strong>

                    <label
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 12px",
                            border: "1px solid #d1d5db",
                            borderRadius: 6,
                            background: isReady ? "#fff" : "#f3f4f6",
                            cursor: isReady ? "pointer" : "not-allowed",
                        }}
                    >
                        <span>{isLoading ? "불러오는 중..." : "모델 가져오기(IFC, FRAG)"}</span>
                        <input
                            type="file"
                            accept=".ifc,.frag"
                            disabled={!isReady || isLoading}
                            onChange={handleIfcUpload}
                            style={{ display: "none" }}
                        />
                    </label>

                    <button
                        type="button"
                        onClick={downloadCurrentFrag}
                        disabled={!isReady || isLoading || !hasDownloadableFrag}
                        style={{
                            padding: "8px 12px",
                            border: "1px solid #d1d5db",
                            borderRadius: 6,
                            background:
                                !isReady || isLoading || !hasDownloadableFrag ? "#f3f4f6" : "#fff",
                            color:
                                !isReady || isLoading || !hasDownloadableFrag ? "#9ca3af" : "#111827",
                            cursor:
                                !isReady || isLoading || !hasDownloadableFrag
                                    ? "not-allowed"
                                    : "pointer",
                        }}
                    >
                        현재 모델 .frag 다운로드
                    </button>
                </div>

                <span style={{ fontSize: 13, color: "#6b7280" }}>{status}</span>
            </div>

            <div
                ref={containerRef}
                style={{
                    position: "relative",
                    flex: 1,
                    minHeight: 0,
                    background:
                        "linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(241,245,249,1) 100%)",
                }}
            >
                {selectedProperties && (
                    <div
                        style={{
                            position: "absolute",
                            top: 10,
                            right: 10,
                            width: 320,
                            maxHeight: "calc(100% - 20px)",
                            overflowY: "auto",
                            background: "rgba(255, 255, 255, 0.95)",
                            border: "1px solid #d1d5db",
                            borderRadius: 8,
                            boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
                            padding: 16,
                            zIndex: 10,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                            }}
                        >
                            <strong style={{ fontSize: 14 }}>속성 정보</strong>
                            <button
                                onClick={() => setSelectedProperties(null)}
                                style={{
                                    border: "none",
                                    background: "transparent",
                                    cursor: "pointer",
                                    fontSize: 18,
                                    color: "#6b7280",
                                }}
                            >
                                &times;
                            </button>
                        </div>

                        <div style={{ fontSize: 12, wordBreak: "break-all" }}>
                            {selectedProperties.message || selectedProperties.error ? (
                                <pre
                                    style={{
                                        margin: 0,
                                        whiteSpace: "pre-wrap",
                                        color: "#374151",
                                    }}
                                >
                                    {JSON.stringify(selectedProperties, null, 2)}
                                </pre>
                            ) : (
                                <>
                                    <BasicAttributesView data={selectedProperties} />
                                    <PropertySetsView data={selectedProperties} />
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
