import React, { useCallback, useState, useRef } from 'react';
import { colors, radius, transitions } from '../tokens.js';

export interface FileDropZoneProps {
  accept: string;
  label: string;
  hint?: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export function FileDropZone({
  accept,
  label,
  hint,
  onFile,
  disabled = false,
  icon,
}: FileDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile, disabled],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        border: `1px dashed ${dragOver ? colors.accent : colors.borderHover}`,
        borderRadius: radius.md,
        padding: '32px 24px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: dragOver ? colors.accentMuted : 'transparent',
        transition: `all ${transitions.normal}`,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
      {icon && <div style={{ marginBottom: '12px', fontSize: '28px', opacity: 0.7 }}>{icon}</div>}
      <div style={{ fontSize: '14px', fontWeight: 500, color: colors.text1, marginBottom: '4px' }}>
        {label}
      </div>
      {hint && (
        <div style={{ fontSize: '13px', color: colors.text3 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
