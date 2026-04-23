import * as React from 'react';

export function CopyButton(props: { value: string | null; label: string }) {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle');

  if (!props.value) {
    return null;
  }

  return (
    <button
      type="button"
      className="secondary-button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.value!);
          setState('copied');
        } catch {
          setState('failed');
        }

        window.setTimeout(() => setState('idle'), 1200);
      }}
    >
      {state === 'copied'
        ? `${props.label} copied`
        : state === 'failed'
          ? `Copy ${props.label} failed`
          : `Copy ${props.label}`}
    </button>
  );
}
