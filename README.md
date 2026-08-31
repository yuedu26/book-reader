# EPUB 阅读器 PWA

一个功能完整的 EPUB 电子书阅读器，采用纯 PWA（Progressive Web App）方案开发。

## 技术栈

- **构建工具**: Vite
- **前端框架**: React 18 + TypeScript
- **路由**: React Router DOM (HashRouter)
- **EPUB 解析**: epub.js
- **状态管理**: Zustand
- **数据存储**: IndexedDB (EPUB 文件) + localStorage (元数据/设置)
- **PWA**: vite-plugin-pwa (Service Worker + Web App Manifest)

## 功能特性

### ✅ 已完成

1. **书架管理**
   - 导入 EPUB 书籍
   - 展示书籍列表（封面、书名、作者、进度）
   - 删除书籍（同时删除文件、进度、笔记）
   - 显示最后阅读时间

2. **阅读功能**
   - EPUB 解析与渲染（epub.js）
   - 翻页模式（左右滑动）
   - 滚动模式（上下滚动）
   - 目录/章节跳转
   - 阅读进度记录（自动保存）
   - 全屏阅读（点击屏幕中间显示/隐藏工具栏）
   - 上一章/下一章切换

3. **阅读设置**
   - 字体大小调节（12-28px）
   - 字体切换（Georgia / Literata / 系统字体 / 宋体）
   - 背景色切换（5种）
     - 银河白：#FFFFFF
     - 豆沙绿：#C7EDCC
     - 杏仁黄：#FAF9DE
     - 秋叶褐：#FFF2E2
     - 夜间黑：#1A1A1A
   - 行高调节（1.2-3.0）
   - 翻页/滚动模式切换

4. **标注功能**
   - 划线高亮（5种颜色）
   - 批注功能
   - 笔记导出为 TXT 文件

5. **书签功能**
   - 添加书签
   - 书签列表
   - 点击书签跳转

6. **英语学习功能**
   - 划词翻译：选中英文单词加入生词本
   - 生词本：
     - 自动记录查过的词
     - 按章节分组显示
     - 标记复习次数
     - 删除单词

7. **阅读统计**
   - 本次阅读时长
   - 累计阅读时长
   - 每日阅读统计（最近7天图表）

8. **数据备份**
   - 手动导出：导出笔记、生词本为 JSON 文件
   - 手动导入：从备份文件恢复数据
   - 定期提醒备份（超过7天弹窗提醒）

9. **PWA 特性**
   - 可安装到主屏幕
   - 离线可用
   - Service Worker 缓存

## 项目结构

```
reader-pwa/
├── public/
│   ├── favicon.svg
│   └── icons/              # PWA 图标
├── src/
│   ├── main.tsx            # 入口文件
│   ├── App.tsx             # 根组件 + 路由
│   ├── pages/
│   │   ├── Bookshelf.tsx   # 书架页
│   │   ├── Reader.tsx      # 阅读页
│   │   ├── Vocabulary.tsx  # 生词本页
│   │   └── Stats.tsx       # 统计页
│   ├── components/
│   │   ├── Icons.tsx       # SVG 图标组件
│   │   ├── SettingsPanel.tsx
│   │   ├── TOCPanel.tsx
│   │   ├── BookmarkList.tsx
│   │   └── HighlightPopup.tsx
│   ├── services/
│   │   ├── db.ts           # IndexedDB 操作
│   │   └── backup.ts       # 导入/导出
│   ├── stores/
│   │   └── index.ts        # Zustand store
│   ├── types/
│   │   └── index.ts        # TypeScript 类型定义
│   ├── utils/
│   │   └── index.ts        # 工具函数
│   └── styles/
│       └── app.css         # 全局样式 + 主题
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

## 使用

1. 打开浏览器访问 `http://localhost:5173/`
2. 点击"导入"按钮选择 EPUB 文件
3. 点击书籍卡片开始阅读
4. 点击屏幕中间区域显示/隐藏工具栏
5. 选中文本可以高亮、添加批注或加入生词本

## 数据存储

- **IndexedDB**: 存储 EPUB 文件的 ArrayBuffer（大文件）
- **localStorage**: 存储书籍元数据、设置、高亮、书签、生词、统计（小数据）

## 浏览器兼容性

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- 支持 PWA 的移动端浏览器

## 注意事项

1. EPUB 文件存储在浏览器 IndexedDB 中，清除浏览器数据会删除所有书籍
2. 建议定期导出备份以防数据丢失
3. PWA 需要 HTTPS 环境才能安装（开发环境 localhost 除外）
