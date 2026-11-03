import { tv } from 'tailwind-variants/lite'

export const qr = tv({
  slots: {
    layout: 'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)] gap-[14px] max-[720px]:grid-cols-1',
    visual: 'border border-dashed border-accent-border rounded-[14px] bg-qr min-h-[230px] p-[14px] flex flex-col gap-[10px] justify-center text-heading max-[720px]:min-h-[180px]',
    badge: 'self-start border border-solid border-accent-border bg-surface text-heading rounded-[999px] py-[4px] px-[10px] text-[12px]',
    hint: 'text-text text-[14px] leading-[1.45]',
    frame: 'w-fit p-[12px] rounded-[16px] bg-white text-black border border-solid border-qr-border shadow-qr',
    link: 'inline-flex w-fit items-center gap-[6px] text-accent no-underline text-[13px] font-600 hover:underline',
    url: 'font-mono text-heading border border-solid border-border rounded-[10px] bg-code p-[10px] text-[12px] leading-[1.45] max-h-[100px] overflow-auto [overflow-wrap:anywhere]',
    placeholder: 'w-[132px] h-[132px] rounded-[12px] border border-solid border-border [background:repeating-linear-gradient(45deg,color-mix(in_srgb,var(--muted)_75%,var(--surface)),color-mix(in_srgb,var(--muted)_75%,var(--surface))_10px,transparent_10px,transparent_20px)] relative overflow-hidden',
    marker: 'absolute border-2 border-solid border-qr-marker rounded-[6px] w-[28px] h-[28px]',
  },
})
