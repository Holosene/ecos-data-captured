import React from 'react';
import { useNavigate } from 'react-router-dom';
import { StepIndicator, colors } from '@echos/ui';
import type { Step } from '@echos/ui';
import { useAppState, type WizardStep } from '../store/app-state.js';
import { ImportStep } from '../components/ImportStep.js';
import { CropStep } from '../components/CropStep.js';
import { CalibrationStep } from '../components/CalibrationStep.js';
import { SyncStep } from '../components/SyncStep.js';
import { GenerateStep } from '../components/GenerateStep.js';
import { ViewerStep } from '../components/ViewerStep.js';

const STEPS: Step[] = [
  { key: 'import', label: 'Import' },
  { key: 'crop', label: 'Crop' },
  { key: 'calibration', label: 'Calibrate' },
  { key: 'sync', label: 'Sync' },
  { key: 'generate', label: 'Generate' },
  { key: 'viewer', label: 'Viewer' },
];

const STEP_ORDER: WizardStep[] = ['import', 'crop', 'calibration', 'sync', 'generate', 'viewer'];

function getStepIndex(step: WizardStep): number {
  return STEP_ORDER.indexOf(step);
}

export function WizardPage() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();
  const currentIdx = getStepIndex(state.currentStep === 'home' ? 'import' : state.currentStep);

  React.useEffect(() => {
    if (state.currentStep === 'home') {
      dispatch({ type: 'SET_STEP', step: 'import' });
    }
  }, [state.currentStep, dispatch]);

  const handleStepClick = (index: number) => {
    dispatch({ type: 'SET_STEP', step: STEP_ORDER[index] });
  };

  return (
    <div style={{ background: colors.black, minHeight: 'calc(100vh - 64px)' }}>
      {/* Step tabs */}
      <div
        style={{
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          maxWidth: '960px',
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
          maxWidth: '960px',
          width: '100%',
          margin: '0 auto',
          padding: '32px 24px',
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
