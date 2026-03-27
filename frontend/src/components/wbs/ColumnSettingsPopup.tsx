import React, { useState } from 'react';

export type ColumnConfig = {
    id: string;
    header: string;
    visible: boolean;
    width?: number; // 간트 트리그리드에서 사용자가 마우스로 드래그하여 임의 조절한 컬럼 넓이를 지속적으로 기억하기 위한 상태 속성입니다.
};

interface ColumnSettingsPopupProps {
    columns: ColumnConfig[];
    onApply: (columns: ColumnConfig[]) => void;
    onClose: () => void;
}

export default function ColumnSettingsPopup({ columns, onApply, onClose }: ColumnSettingsPopupProps) {
    const [localCols, setLocalCols] = useState<ColumnConfig[]>(columns);
    const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIdx(index);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `${index}`);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // Necessary to allow dropping
        e.dataTransfer.dropEffect = "move";
    };

    const handleDrop = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (draggedIdx === null || draggedIdx === index) return;

        const newCols = [...localCols];
        const draggedItem = newCols[draggedIdx];
        newCols.splice(draggedIdx, 1);
        newCols.splice(index, 0, draggedItem);

        setLocalCols(newCols);
        setDraggedIdx(null);
    };

    const toggleVisibility = (index: number) => {
        const newCols = [...localCols];
        newCols[index].visible = !newCols[index].visible;
        setLocalCols(newCols);
    };

    return (
        <div style={overshadowStyle}>
            <div style={popupStyle}>
                <h3 style={{ marginTop: 0 }}>컬럼 설정</h3>
                <div style={{ paddingBottom: 8, borderBottom: '1px solid #eee', marginBottom: 8, fontSize: '0.9rem', color: '#666' }}>
                    항목을 위아래로 드래그하여 순서를 변경하거나 체크를 통해 표시 여부를 설정하세요.
                </div>
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {localCols.map((col, idx) => (
                        <div
                            key={col.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, idx)}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, idx)}
                            onDragEnd={() => setDraggedIdx(null)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '8px',
                                borderBottom: '1px solid #f0f0f0',
                                backgroundColor: draggedIdx === idx ? '#f3f4f6' : '#fff',
                                cursor: 'grab'
                            }}
                        >
                            <span style={{ marginRight: '8px', color: '#9ca3af', cursor: 'grab' }}>☰</span>
                            <input
                                type="checkbox"
                                checked={col.visible}
                                onChange={() => toggleVisibility(idx)}
                                style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '14px', flex: 1 }}>{col.header}</span>
                        </div>
                    ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                    <button onClick={onClose} style={btnStyle('#fff', '#374151', '#d1d5db')}>취소</button>
                    <button onClick={() => onApply(localCols)} style={btnStyle('#3b82f6', '#fff', 'transparent')}>적용</button>
                </div>
            </div>
        </div>
    );
}

const overshadowStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999
};

const popupStyle: React.CSSProperties = {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '20px',
    width: '400px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
};

const btnStyle = (bg: string, color: string, border: string): React.CSSProperties => ({
    padding: '8px 16px',
    backgroundColor: bg,
    color: color,
    border: `1px solid ${border}`,
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 'bold',
});
