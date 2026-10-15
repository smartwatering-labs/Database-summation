# 植物条目资料核对记录

核对日期：2026-10-14。范围为初始植物库的 8 个条目。资料来自高校农业推广机构，写入 `evidence` 仅说明定性种植背景。条目继续保持 `review.status=engineering`、`fieldValidation.status=untested`；每日 mL、土壤/温度/空气权重、需求阈值及季节间隔均未由下列资料直接推导。

| 条目 | 核对资料 | 可支持的背景 | 参数审核结论 |
| --- | --- | --- | --- |
| 番茄 | [明尼苏达大学：家庭种植番茄](https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/growing-tomatoes) | 室外生长、根区保湿及透浇 | 450 mL/日及权重、阈值仍为工程建议 |
| 辣椒 | [明尼苏达大学：种植辣椒](https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/growing-peppers) | 生长阶段、干旱及水分管理 | 350 mL/日及权重、阈值仍为工程建议 |
| 生菜 | [明尼苏达大学：家庭种植生菜](https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/growing-lettuce-endive-and-radicchio) | 表层根系、土壤保湿 | 250 mL/日及权重、阈值仍为工程建议 |
| 罗勒 | [明尼苏达大学：家庭种植罗勒](https://extension.umn.edu/garden-and-home/yard-and-garden/yard-and-garden-problems/growing-basil) | 光照、排水及容器与地栽差异 | 220 mL/日及权重、阈值仍为工程建议 |
| 薄荷 | [明尼苏达大学：家庭种植香草](https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/growing-herbs) | 香草类浇水和排水原则；薄荷种属覆盖较宽 | 250 mL/日及权重、阈值仍为工程建议 |
| 绿萝 | [宾夕法尼亚州立大学：室内绿萝](https://extension.psu.edu/pothos-as-a-houseplant) | 室内散射光、土壤干燥后浇水和积水风险 | 140 mL/日及权重、阈值仍为工程建议 |
| 月季 | [克莱姆森大学：玫瑰栽培](https://hgic.clemson.edu/factsheet/growing-roses/) | 玫瑰类根区浇水，具体品种需再核对 | 350 mL/日及权重、阈值仍为工程建议 |
| 多肉植物 | [明尼苏达大学：仙人掌与多肉](https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/cacti-and-succulents) | 排水、光照及浇水间干燥；该条目覆盖多个物种 | 60 mL/日及权重、阈值仍为工程建议 |

资料说明的是特定地区、栽培方式和生长阶段的种植原则，不能直接换算成项目的单盆日需水量或 ADC 阈值。要将某条目标记为“资料已审核”，需确定植物品种、花盆/土壤与场景，给出数值依据和审核日期。要标记为“实物验证”，还需记录传感器端点、泵流量、出水量、介质和连续运行结果。管理端已有对应字段；当前迁移只填充空的定性资料字段，不提升审核或实测状态。
