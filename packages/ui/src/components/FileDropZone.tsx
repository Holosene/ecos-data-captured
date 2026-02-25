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
      if (file && typeof onFile === 'function') onFile(file);
    },
    [onFile, disabled],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && typeof onFile === 'function') onFile(file);
      // Reset input value so selecting the same file again triggers onChange
      if (e.target) e.target.value = '';
    },
    [onFile],
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      style={{
        border: `1px dashed ${dragOver ? colors.accent : colors.borderHover}`,
        borderRadius: radius.md,
        padding: '32px 24px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: dragOver ? colors.accentMuted : 'transparent',
        transition: `all ${transitions.normal}`,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        style={{ display: 'none' }}
        tabIndex={-1}
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
