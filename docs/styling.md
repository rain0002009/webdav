# 前端样式

使用 UnoCSS 生成工具类，使用 `tailwind-variants/lite` 组织可复用样式、slots 和变体。日常开发不需要新增 `.css` 文件。

- `uno.config.ts`：主题色、字体、阴影，以及全局文档默认值。深浅色跟随系统设置；组件样式不要放进 `preflights`。
- `src/lib/styles.ts`：两页共用的按钮、卡片、提示框、表单和页面样式。
- `src/features/console/styles.ts`：二维码区域的专用 slots。
- 页面独有的简单布局直接写在 JSX 的 `className` 中。

```tsx
import { button, card } from '../../lib/styles'

const styles = card()

<section className={styles.base()}>
  <button className={button({ intent: 'danger' })}>清理会话</button>
</section>
```

类名必须是完整的静态字符串，避免拼接 `bg-${color}` 等动态工具类；有状态差异时用 `tv` 的 `variants`。UnoCSS 已配置扫描构建管线中的 `.ts`、`.tsx` 和 HTML，包括独立样式定义文件。

`lite` 入口只组合类名，不执行 Tailwind 专用的冲突合并。互斥样式放入变体中，不要依赖后传入的 `class` 覆盖同类工具类。`class` 适合补充定位、截断等不冲突的样式。

入口只导入 `virtual:uno.css`，这是构建时生成的虚拟样式，不是手写 CSS 文件。确实无法用工具类或变体表达时，再考虑少量独立 CSS，并说明原因。

修改后执行 `pnpm lint` 和 `pnpm build`；样式迁移还应检查实际页面的桌面/移动端、深浅色和禁用状态。
