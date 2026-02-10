import React from 'react';
import { StepIndicator, colors } from '@echos/ui';
import type { Step } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';
import { useAppState, type WizardStep } from '../store/app-state.js';
import { ImportStep } from '../components/ImportStep.js';
import { CropStep } from '../components/CropStep.js';
import { CalibrationStep } from '../components/CalibrationStep.js';
import { SyncStep } from '../components/SyncStep.js';
import { GenerateStep } from '../components/GenerateStep.js';
import { ViewerStep } from '../components/ViewerStep.js';

const STEP_ORDER: WizardStep[] = ['import', 'crop', 'calibration', 'sync', 'generate', 'viewer'];

function getStepIndex(step: WizardStep): number {
  return STEP_ORDER.indexOf(step);
}

export function WizardPage() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();
  const currentIdx = getStepIndex(state.currentStep === 'home' ? 'import' : state.currentStep);

  const STEPS: Step[] = [
    { key: 'import', label: t('step.import') },
    { key: 'crop', label: t('step.crop') },
    { key: 'calibration', label: t('step.calibration') },
    { key: 'sync', label: t('step.sync') },
    { key: 'generate', label: t('step.generate') },
    { key: 'viewer', label: t('step.viewer') },
  ];

  React.useEffect(() => {
    if (state.currentStep === 'home') {
      dispatch({ type: 'SET_STEP', step: 'import' });
    }
  }, [state.currentStep, dispatch]);

  const handleStepClick = (index: number) => {
    dispatch({ type: 'SET_STEP', step: STEP_ORDER[index] });
  };

  return (
    <div style={{ background: colors.black, minHeight: 'calc(100vh - 72px)' }}>
      {/* Stepper */}
      <div
        style={{
          borderBottom: `1px solid ${colors.border}`,
          padding: '0 clamp(20px, 5vw, 48px)',
          maxWidth: '1100px',
          margin: '0 auto',
        }}
      >
        <StepIndicator
          steps={STEPS}
          currentStep={currentIdx}
          onStepClick={handleStepClick}
        />
      </div>

      {/* Content */}
      <div
        style={{
          maxWidth: '1100px',
          width: '100%',
          margin: '0 auto',
          padding: 'clamp(24px, 3vw, 48px) clamp(20px, 5vw, 48px)',
        }}
      >
        {(state.currentStep === 'home' || state.currentStep === 'import') && <ImportStep />}
        {state.currentStep === 'crop' && <CropStep />}
        {state.currentStep === 'calibration' && <CalibrationStep />}
        {state.currentStep === 'sync' && <SyncStep />}
        {state.currentStep === 'generate' && <GenerateStep />}
        {state.currentStep === 'viewer' && <ViewerStep />}
      </div>
    </div>
  );
}
