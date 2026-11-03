import { tv } from 'tailwind-variants/lite'

// UnoCSS handles the utilities; the lite entry avoids Tailwind-specific merging.
export const page = tv({
  slots: {
    base: 'box-border grid w-full max-w-[960px] mx-auto gap-[18px] px-[24px] pt-[28px] pb-[40px] text-left max-[720px]:px-[14px] max-[720px]:pt-[18px] max-[720px]:pb-[24px]',
    title: 'm-0 font-sans font-500 text-heading text-[32px] tracking-[-0.2px] max-[720px]:text-[28px]',
    subtitle: 'mt-[10px] text-text',
  },
})

export const button = tv({
  base: 'font-sans text-[13px] font-500 leading-[1.1] text-heading border border-solid rounded-[10px] py-[9px] px-[12px] cursor-pointer transition-[border-color,transform] duration-200 enabled:hover:border-accent enabled:hover:translate-y-[-1px] disabled:opacity-60 disabled:cursor-not-allowed max-[720px]:w-full',
  variants: {
    intent: {
      primary: 'border-accent-border bg-accent-soft',
      ghost: 'border-accent-border bg-muted',
      danger: 'border-[#c43d54] bg-[rgba(196,61,84,0.12)]',
    },
  },
  defaultVariants: { intent: 'primary' },
})

export const card = tv({
  slots: {
    base: 'border border-solid rounded-[14px] p-[18px] bg-surface shadow-card',
    header: 'flex justify-between items-start gap-[12px] mb-[16px] max-[720px]:flex-col',
    title: 'm-0 font-sans font-500 text-heading text-[24px] leading-[1.2] tracking-[-0.24px] max-[1024px]:text-[20px]',
    actions: 'inline-flex gap-[8px] max-[720px]:w-full max-[720px]:grid max-[720px]:grid-cols-2',
    footnote: 'mt-[12px] text-[13px] text-text',
  },
  variants: {
    intent: {
      default: { base: 'border-border' },
      danger: { base: 'border-[rgba(196,61,84,0.5)]' },
    },
  },
  defaultVariants: { intent: 'default' },
})

export const notice = tv({
  base: 'border border-solid rounded-[12px] p-[12px]',
  variants: {
    intent: {
      info: 'border-accent-border bg-accent-soft',
      error: 'border-[rgba(196,61,84,0.6)] bg-[rgba(196,61,84,0.1)]',
      warning: 'border-[rgba(180,83,9,0.6)] bg-[rgba(180,83,9,0.12)]',
    },
  },
  defaultVariants: { intent: 'info' },
})

export const details = tv({
  slots: {
    base: 'm-0 grid grid-cols-2 gap-[10px] max-[720px]:grid-cols-1',
    item: 'border border-solid border-border rounded-[12px] py-[10px] px-[12px] bg-inset',
    term: 'text-text text-[13px] mb-[4px]',
    value: 'm-0 text-heading text-[14px] leading-[1.35]',
  },
})

export const field = tv({
  base: 'block text-[14px] text-heading',
  variants: {
    inline: {
      true: 'mb-0',
      false: 'mb-[8px]',
    },
  },
  defaultVariants: { inline: false },
})

export const input = tv({
  base: 'w-full box-border border border-solid border-border rounded-[12px] [font:inherit] text-heading bg-code p-[10px]',
  variants: { multiline: { true: 'resize-y' } },
})

export const code = tv({
  base: 'font-mono inline-flex rounded-[4px] text-heading text-[15px] leading-[1.35] py-[4px] px-[8px] bg-code',
})
