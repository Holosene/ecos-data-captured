import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function DocsPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/', { replace: true });
    const scrollTimeout = setTimeout(() => {
      document.getElementById('docs-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 150);
    return () => clearTimeout(scrollTimeout);
  }, [navigate]);

  return null;
}
