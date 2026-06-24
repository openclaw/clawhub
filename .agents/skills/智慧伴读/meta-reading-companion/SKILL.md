---

name: meta-reading-companion
description: "分层阅读伴侣，基于花叔《阅读的方法》改良版实现：帮你从「读完一本书」升级到「真正读懂一本书」，支持三级深度模式：轻量（狩猎法，快速定位内容）→ 标准（狩猎+费曼，内化概念）→ 深度（狩猎+费曼+辩论，压力测试）。最终可输出markdown笔记和huashu-design可视化HTML阅读卡片。触发条件：用户说「分层阅读」「阅读伴侣」「深度阅读」「帮我读懂一本书」「帮我阅读一本书」「从读完到读懂」时使用。仅用于主动阅读（带问题/带困惑），不用于泛读全书总结。"
kind: meta
meta_priority: 60
always: false
final_text_mode: "step:output_final"
triggers:
  - 分层阅读
  - 阅读伴侣
  - 深度阅读
  - 帮我读懂一本书
  - 真正读懂一本书
  - 从读完到读懂
  - reading companion
metadata:
  opensquilla:
    risk: low
    capabilities: [filesystem-read]
composition:
  steps:
    - id: intake
      kind: llm_chat
      depends_on: []
      with:
        system: "你是分层阅读伴侣的需求 intake 节点，严格按以下逻辑处理。"
        task: |
          解析用户的请求：
          - 提取：书名/作者、用户当前具体要解决的问题/困惑、用户上传的PDF路径（如果有）
          - 判断：用户想要选择哪个深度模式？

          三个模式说明：
          1. **轻量模式**：只做狩猎法 → 根据你的问题定位书中最相关内容，苏格拉底追问帮你链接问题
          2. **标准模式**：狩猎法定位 + 费曼法内化 → 帮你把概念说清楚，暴露模糊地带
          3. **深度模式**：狩猎+费曼+华山论剑 → 完整压力测试，跨学科对手攻击，裁判给出结构化裁决
          最后可选择生成 huashu-design 可视化阅读卡片

          如果用户没有指定模式，根据用户问题推荐一个：
          - 只是想快速找答案 → 推荐轻量
          - 想把一个概念搞懂 → 推荐标准
          - 想验证一个核心观点是否经得起推敲 → 推荐深度

          确认后，输出确认话术，等待用户确认。不要自己跳下一步。

          用户输入：
          {{ inputs.user_message | xml_escape | truncate(4000) }}

    - id: confirm_depth
      kind: user_input
      depends_on: [intake]
      clarify:
        mode: form
        intro: "请确认你想要的阅读深度模式："
        fields:
          - name: depth_mode
            type: string
            required: true
            prompt: "轻量 / 标准 / 深度"
            max_chars: 20

    - id: do_hunting
      kind: llm_chat
      depends_on: [confirm_depth]
      with:
        system: "你正在使用狩猎法阅读。基于用户的问题和书籍，定位最相关的内容并用苏格拉底追问链接到用户的具体问题。不要替用户总结全书，不要直接给答案。"
        task: |
          用户问题：{{ inputs.user_message | xml_escape | truncate(4000) }}
          选择的模式：{{ steps.confirm_depth.output.depth_mode }}

          执行狩猎法：
          1. 从书中定位与用户问题最相关的3-5个核心观点/章节
          2. 对每个观点，说明它为什么与用户的问题相关
          3. 最后提出1-2个苏格拉底追问，把球踢回给用户

    - id: hunting_check
      kind: user_input
      depends_on: [do_hunting]
      clarify:
        mode: form
        intro: "狩猎法定位结果已出。是否继续下一步？"
        fields:
          - name: continue
            type: string
            required: true
            prompt: "继续 / 调整 / 停止"
            max_chars: 20

    - id: do_feynman
      kind: llm_chat
      depends_on: [hunting_check]
      with:
        system: "你正在使用费曼法。你是魔鬼教练，任务是帮用户暴露理解上的模糊地带。每轮只问1-2个问题，持续追问直到用户能用简单的类比讲清楚。不要直接给定义。"
        task: |
          基于狩猎法定位的内容，选择最核心的一个概念，开始费曼法追问：
          1. 要求用户用6岁孩子能听懂的话解释这个概念
          2. 根据用户的回答，找到模糊点继续追问
          3. 持续到用户能说清楚为止

    - id: feynman_check
      kind: user_input
      depends_on: [do_feynman]
      clarify:
        mode: form
        intro: "费曼法澄清完成。是否继续到辩论压力测试？"
        fields:
          - name: continue
            type: string
            required: true
            prompt: "继续 / 停止"
            max_chars: 20

    - id: do_debate
      kind: skill_exec
      depends_on: [feynman_check]
      skill: meta-huashan-debate

    - id: debate_check
      kind: user_input
      depends_on: [do_debate]
      clarify:
        mode: form
        intro: "辩论结束。是否编译结构化阅读笔记？"
        fields:
          - name: continue
            type: string
            required: true
            prompt: "编译笔记 / 跳过"
            max_chars: 20

    - id: compile_notes
      kind: llm_chat
      depends_on: [debate_check]
      with:
        system: "你是一位阅读笔记整理专家。将本次阅读的完整流程（狩猎定位、费曼澄清、辩论裁决）编译成一份结构化的阅读压力测试报告。"
        task: |
          基于本次阅读的全部内容，编译一份结构化报告，包含：
          1. 核心观点锚定
          2. 费曼法澄清记录
          3. 压力测试结果（交锋记录+最终裁决）
          4. 用户的反思
          5. 后续延伸思考

          保存为 markdown 文件。

    - id: need_visual
      kind: user_input
      depends_on: [compile_notes]
      clarify:
        mode: form
        intro: "笔记已编译完成。是否生成可视化阅读卡片？"
        fields:
          - name: generate_visual
            type: string
            required: true
            prompt: "生成 / 跳过"
            max_chars: 20

    - id: do_visual
      kind: skill_exec
      depends_on: [need_visual]
      skill: huashu-design

    - id: output_final
      kind: llm_chat
      depends_on: [need_visual, do_visual]
      with:
        system: "输出最终结果给用户。"
        task: |
          总结本次阅读的完整流程和产出物，告知用户所有文件已就绪。

---

