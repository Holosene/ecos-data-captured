import React, { useEffect, useCallback, useState, useRef } from 'react';

interface ImageLightboxProps {
  images: string[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function ImageLightbox({ images, currentIndex, onClose, onNavigate }: ImageLightboxProps) {
  const [entering, setEntering] = useState(true);
  const [exiting, setExiting] = useState(false);
  const [sliding, setSliding] = useState<'left' | 'right' | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragDelta = useRef(0);

  // Entrance animation
  useEffect(() => {
    requestAnimationFrame(() => setEntering(false));
  }, []);

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(onClose, 250);
  }, [onClose]);

  const goTo = useCallback((index: number, direction: 'left' | 'right') => {
    if (index < 0 || index >= images.length) return;
    setSliding(direction);
    setTimeout(() => {
      onNavigate(index);
      setSliding(null);
    }, 200);
  }, [images.length, onNavigate]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) goTo(currentIndex + 1, 'left');
      if (e.key === 'ArrowLeft' && currentIndex > 0) goTo(currentIndex - 1, 'right');
    },
    [handleClose, goTo, currentIndex, images.length],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  // Touch/mouse drag to navigate
  const handlePointerDown = (e: React.PointerEvent) => {
    if (zoomed) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragDelta.current = 0;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current || zoomed) return;
    dragDelta.current = e.clientX - dragStart.current.x;
  };

  const handlePointerUp = () => {
    if (!dragStart.current || zoomed) { dragStart.current = null; return; }
    const delta = dragDelta.current;
    dragStart.current = null;
    if (Math.abs(delta) > 60) {
      if (delta < 0 && currentIndex < images.length - 1) goTo(currentIndex + 1, 'left');
      if (delta > 0 && currentIndex > 0) goTo(currentIndex - 1, 'right');
    }
  };

  // Image transform for slide animation
  const getImageTransform = () => {
    if (sliding === 'left') return 'translateX(-30px) scale(0.96)';
    if (sliding === 'right') return 'translateX(30px) scale(0.96)';
    if (entering) return 'scale(0.85)';
    if (exiting) return 'scale(0.85)';
    if (zoomed) return 'scale(1.8)';
    return 'scale(1)';
  };

  return (
    <div
      onClick={handleClose}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: entering || exiting ? 'rgba(0, 0, 0, 0)' : 'rgba(0, 0, 0, 0.35)',
        backdropFilter: entering || exiting ? 'blur(0px)' : 'blur(20px)',
        WebkitBackdropFilter: entering || exiting ? 'blur(0px)' : 'blur(20px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: zoomed ? 'zoom-out' : 'default',
        transition: 'background 300ms ease, backdrop-filter 300ms ease',
        touchAction: 'none',
      }}
    >
      {/* Main image */}
      <img
        src={images[currentIndex]}
        alt=""
        onClick={(e) => {
          e.stopPropagation();
          setZoomed(!zoomed);
        }}
        style={{
          maxWidth: zoomed ? '100vw' : '88vw',
          maxHeight: zoomed ? '100vh' : '78vh',
          objectFit: 'contain',
          borderRadius: '12px',
          cursor: zoomed ? 'zoom-out' : 'zoom-in',
          transform: getImageTransform(),
          opacity: entering || exiting || sliding ? 0.6 : 1,
          transition: 'transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 250ms ease, max-width 300ms ease, max-height 300ms ease',
          pointerEvents: 'auto',
          userSelect: 'none',
        }}
        draggable={false}
      />

      {/* Thumbnail strip — only selection interface */}
      {images.length > 1 && (
        <div
          className="lightbox-thumbs"
          style={{
            position: 'absolute',
            bottom: '32px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '8px',
            padding: '8px 12px',
            background: 'rgba(0,0,0,0.5)',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.08)',
            opacity: entering || exiting ? 0 : 1,
            transition: 'opacity 300ms ease',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((img, i) => (
            <button
              key={i}
              onClick={() => {
                const dir = i > currentIndex ? 'left' : 'right';
                goTo(i, dir);
              }}
              style={{
                width: '77px',
                height: '58px',
                borderRadius: '8px',
                overflow: 'hidden',
                border: i === currentIndex ? '2px solid rgba(255,255,255,0.8)' : '2px solid transparent',
                padding: 0,
                cursor: 'pointer',
                opacity: i === currentIndex ? 1 : 0.5,
                transition: 'all 200ms ease',
                background: 'transparent',
              }}
              onMouseEnter={(e) => { if (i !== currentIndex) (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
              onMouseLeave={(e) => { if (i !== currentIndex) (e.currentTarget as HTMLElement).style.opacity = '0.5'; }}
            >
              <img
                src={img}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
