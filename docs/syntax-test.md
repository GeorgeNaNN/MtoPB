# MtoPB Markdown 语法测试

本文档用代表性示例手动检查 MtoPB 的 CommonMark/GFM、插件扩展和项目自定义语法。示例通过不等于通过完整的 Markdown/GFM 规范一致性测试。

## 一、CommonMark 与 GFM 语法

### 1. ATX 标题

#### 四级标题

##### 五级标题

###### 六级标题

Setext 一级标题示例
===

Setext 二级标题示例
---

### 2. 普通段落

这是第一个普通段落。

这是第二个普通段落。

### 3. 软换行

这是软换行第一行，
这一行通常仍属于同一个段落。

### 4. 使用两个空格强制换行

这一行末尾有两个空格。  
这一行应出现在下一行。

### 5. 使用反斜杠强制换行

这一行末尾使用反斜杠。\
这一行应出现在下一行。

### 6. 强调文字

**粗体示例**、*斜体示例*、***粗斜体示例***。

### 7. 行内代码

这是行内代码：`const value = 42;`。

### 8. 反引号围栏代码块

```javascript
const message = "MtoPB";
console.log(message);
```

### 9. 波浪线围栏代码块

~~~text
这是使用三个波浪线创建的代码块。
~~~

### 10. 缩进代码块

    这是四空格缩进代码块。
    第二行代码。

### 11. 引用块

> 这是一级引用。
>
> > 这是嵌套的二级引用。

### 12. 无序列表

- 无序列表第一项
- 无序列表第二项
- 无序列表第三项

### 13. 有序列表

1. 有序列表第一项
3. 有序列表第二项
4. 有序列表第三项

### 14. 嵌套列表

- 无序列表父项
  1. 有序子项一
  2. 有序子项二
- 无序列表另一个父项

### 15. 行内链接

[OpenAI 官方网站](https://openai.com)

### 16. 引用式链接

这是[引用式链接示例][ref-link]。

### 17. 尖括号自动链接

<https://example.com>

### 18. 普通图片

![MtoPB 普通图片](<./syntax-test.png>)

### 19. 分隔线

---

### 20. 转义字符

\*这里不是斜体\*，\#这里不是标题，\\这里显示反斜杠。

### 21. HTML 字符实体

&copy; &amp; &#169; &#x1F600;

### 22. 行内 HTML

这是<span style="color: #1688c9; font-weight: 700;">行内 HTML</span>示例。

### 23. HTML 块

<div class="syntax-test-html" style="padding: 10px; border: 1px solid #529cd8; border-radius: 8px;">
这是 HTML 块示例。
</div>

### 24. 表格

| 左对齐 | 居中 | 右对齐 |
| :--- | :---: | ---: |
| A | B | C |
| 1 | 2 | 3 |

### 25. 删除线

~~这是删除线示例~~

~这是单波浪线删除线示例~

### 26. 裸网址自动链接

https://example.com

www.example.com

### 27. 裸电子邮箱自动链接

tester@example.com

### GFM 任务列表

- [ ] 这是未完成任务
- [x] 这是已完成任务
- [X] 这是已完成任务（大写 X）

任务标记后使用普通空格分隔正文；PDF 中的复选框是静态的。

## 二、扩展语法

### 28. KaTeX 行内公式

质能方程为 $E = mc^2$。

### 29. KaTeX 块级公式

$$
a^2 + b^2 = c^2
$$

### 30. 高亮文字

==这是高亮文字示例==

### 31. 自动标题锚点与内部链接

标题锚点由插件自动生成。点击返回本文开头的[CommonMark 与 GFM 语法](#commonmark-与-gfm-语法)。

### 32. note 提示框

:::note 注意
这是 note 提示框示例。
:::

### 33. tip 提示框

:::tip 提示
这是 tip 提示框示例。
:::

### 34. warning 提示框

:::warning 警告
这是 warning 提示框示例。
:::

### 35. danger 提示框

:::danger 危险
这是 danger 提示框示例。
:::

### 36. theorem 环境

:::theorem 勾股定理
直角三角形两直角边平方和等于斜边平方。
:::

### 37. definition 环境

:::definition 质数
只能被 1 和自身整除的大于 1 的自然数。
:::

### 38. example 环境

:::example 示例
这是一个 example 环境示例。
:::

### 39. exercise 环境

:::exercise 练习
请计算 $1 + 1$。
:::

### GitHub Alerts

> [!NOTE]
> 这是 NOTE 提示。

> [!TIP]
> 这是 TIP 提示。

> [!IMPORTANT]
> 这是 IMPORTANT 重要提示。

> [!WARNING]
> 这是 WARNING 警告。

> [!CAUTION]
> 这是 CAUTION 危险提示。

## 三、项目自定义语法

### 40. 自定义图片宽度和高度

![指定宽高|220x140](<./syntax-test.png>)

### 41. 自定义图片宽度

![只指定宽度|220](<./syntax-test.png>)

### 42. 图片题注

![题注图片](<./syntax-test.png> "这是图片下方自动生成的题注")

只有单独成段且段内只有一张 Markdown 图片时，才会生成图片和图注容器。

### 43. 不带尖括号的相对路径

![不带尖括号的相对路径](./syntax-test.png)

此项用于检查不带尖括号的相对图片路径是否能正常解析。

### 44. 手动命名锚点

<a id="manual-anchor"></a>

[点击跳转到手动命名锚点](#manual-anchor)

### 45. 强制分页

\pagebreak

### 46. newpage 强制分页

\newpage

### 47. 项目自定义 CSS

<style>
.syntax-css-example {
  padding: 10px;
  border-left: 4px solid #529cd8;
  background: #eef7ff;
}
</style>

<div class="syntax-css-example">这是通过 style 标签添加的自定义样式。</div>

### 48. JavaScript 嵌入

<script>
const syntaxResult = document.createElement("p");
syntaxResult.textContent = "内嵌 JavaScript 已执行";
document.currentScript.insertAdjacentElement("afterend", syntaxResult);
</script>

检查 PDF 中是否出现“内嵌 JavaScript 已执行”。

### 49. HTML 图片

<img src="./syntax-test.png" alt="HTML 图片" width="120">

### 50. 外部 CSS 文件

<link rel="stylesheet" href="./syntax-test.css">

<div class="syntax-external-css">这段文字使用了外部 CSS 文件。</div>

### 51. 外部 JavaScript 文件

<script src="./syntax-test.js"></script>

<p id="external-js-result">外部 JavaScript 尚未运行</p>
<script>
if (document.documentElement.dataset.mtopbExternalScript === "ok") {
  document.querySelector("#external-js-result").textContent = "外部 JavaScript 已执行";
}
</script>

检查 PDF 中这段文字是否变为“外部 JavaScript 已执行”。

### 52. HTML 标题不会进入目录

<h4>这是 HTML 标题，不会进入 Markdown 目录和 PDF 书签</h4>

### 53. 代码语言高亮与行号

```python
def hello(name):
    print(f"Hello, {name}")

hello("MtoPB")
```

### 54. 多个代码语言

```css
.syntax-code {
  color: #1688c9;
}
```

### 55. 引用式链接定义

[ref-link]: https://example.com "引用式链接标题"

## 目录、页码和 PDF 书签

以下功能由转换过程自动完成，不需要额外 Markdown 指令：

- Markdown 标题会按“目录最大层级”设置加入目录。
- PDF 书签层级与目录层级一致。
- 页眉标题根据当前一级标题自动显示。
- 页码根据“页码计数规则”自动生成。
- 当前文档包含多级标题，可用于检查目录、页眉和书签。

## 测试结束

转换成功只说明这次流程没有报错，不代表每个语法的显示效果都正确。请逐项检查图片、链接跳转、目录与书签、分页、CSS/JavaScript 可见效果和代码高亮，并留意分页造成的视觉差异。
