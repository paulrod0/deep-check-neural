#!/usr/bin/env python3
"""
Galtea Deploy Agent — Automated Enterprise Onboarding Tool
============================================================
A CLI tool that automates 80% of the Forward Deployment Engineer's work:

1. SCAN — Analyze a client's AI repo, detect frameworks and agents
2. INSTRUMENT — Generate Galtea SDK integration code automatically
3. TEST — Run a sample evaluation against detected agents
4. REPORT — Generate a quality report with metrics
5. PR — Open a Pull Request with the integration ready

Usage:
    python galtea_deploy_agent.py --repo /path/to/client/repo --api-key GALTEA_KEY
    python galtea_deploy_agent.py --repo https://github.com/client/ai-agents --api-key GALTEA_KEY

Author: Pablo López Rodríguez
"""

import os
import sys
import json
import argparse
import subprocess
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Dict, Optional
import re

# ── Configuration ────────────────────────────────────────────────────────────

@dataclass
class AgentDetection:
    """Detected AI agent or LLM pipeline in the client's codebase."""
    name: str
    framework: str          # langchain, llamaindex, crewai, openai, custom
    file_path: str
    entry_point: str        # function/class name
    agent_type: str         # rag, conversational, tool-calling, chain
    model_provider: str     # openai, anthropic, local, etc.
    confidence: float       # 0-1

@dataclass
class ScanResult:
    """Result of scanning a client's repository."""
    repo_path: str
    agents: List[AgentDetection] = field(default_factory=list)
    frameworks: List[str] = field(default_factory=list)
    python_version: str = ""
    has_tests: bool = False
    has_ci: bool = False
    total_py_files: int = 0
    ai_files: int = 0


# ── Phase 1: SCAN ────────────────────────────────────────────────────────────

FRAMEWORK_PATTERNS = {
    'langchain': {
        'imports': [r'from langchain', r'import langchain', r'from langchain_core', r'from langchain_community'],
        'markers': [r'ChatOpenAI', r'ConversationChain', r'AgentExecutor', r'RetrievalQA', r'create_react_agent'],
    },
    'llamaindex': {
        'imports': [r'from llama_index', r'import llama_index', r'from llama_index\.core'],
        'markers': [r'VectorStoreIndex', r'QueryEngine', r'SimpleDirectoryReader', r'ServiceContext'],
    },
    'crewai': {
        'imports': [r'from crewai', r'import crewai'],
        'markers': [r'Agent\(', r'Task\(', r'Crew\(', r'Process\.sequential'],
    },
    'openai_agents': {
        'imports': [r'from openai', r'import openai', r'from agents import'],
        'markers': [r'client\.chat\.completions', r'openai\.ChatCompletion', r'Agent\(', r'Runner\.run'],
    },
    'anthropic': {
        'imports': [r'from anthropic', r'import anthropic'],
        'markers': [r'client\.messages\.create', r'claude'],
    },
    'autogen': {
        'imports': [r'from autogen', r'import autogen'],
        'markers': [r'ConversableAgent', r'AssistantAgent', r'UserProxyAgent'],
    },
    'semantic_kernel': {
        'imports': [r'from semantic_kernel', r'import semantic_kernel'],
        'markers': [r'Kernel', r'KernelFunction'],
    },
    'haystack': {
        'imports': [r'from haystack', r'import haystack'],
        'markers': [r'Pipeline\(', r'DocumentStore', r'Retriever'],
    },
}

AGENT_TYPE_PATTERNS = {
    'rag': [r'Retriev', r'VectorStore', r'embedding', r'DocumentStore', r'similarity_search', r'retriever'],
    'conversational': [r'ConversationChain', r'ChatHistory', r'memory', r'MessagesPlaceholder', r'chat_history'],
    'tool-calling': [r'@tool', r'Tool\(', r'function_call', r'tools=\[', r'bind_tools'],
    'chain': [r'SequentialChain', r'LLMChain', r'RunnableSequence', r'LCEL', r'pipe'],
    'multi-agent': [r'Crew\(', r'Agent\(.*Agent\(', r'ConversableAgent', r'swarm'],
}

MODEL_PATTERNS = {
    'openai': [r'gpt-4', r'gpt-3\.5', r'gpt-5', r'ChatOpenAI', r'openai\.', r'OPENAI_API_KEY'],
    'anthropic': [r'claude', r'anthropic', r'ANTHROPIC_API_KEY'],
    'google': [r'gemini', r'palm', r'ChatGoogleGenerativeAI'],
    'local': [r'ollama', r'llama\.cpp', r'vllm', r'HuggingFace', r'AutoModelFor'],
    'azure': [r'AzureOpenAI', r'AZURE_OPENAI', r'azure\.openai'],
}


def scan_repository(repo_path: str) -> ScanResult:
    """Phase 1: Scan client repo to detect AI agents and frameworks."""
    result = ScanResult(repo_path=repo_path)
    repo = Path(repo_path)

    if not repo.exists():
        print(f"[SCAN] Repository not found: {repo_path}")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  GALTEA DEPLOY AGENT — Phase 1: SCAN")
    print(f"  Repository: {repo_path}")
    print(f"{'='*60}\n")

    # Find all Python files
    py_files = list(repo.rglob("*.py"))
    result.total_py_files = len(py_files)
    print(f"[SCAN] Found {len(py_files)} Python files")

    # Check for tests and CI
    result.has_tests = any(p.name.startswith("test_") or "tests" in p.parts for p in py_files)
    result.has_ci = (repo / ".github" / "workflows").exists() or (repo / ".gitlab-ci.yml").exists()

    # Check Python version
    pyproject = repo / "pyproject.toml"
    if pyproject.exists():
        content = pyproject.read_text()
        match = re.search(r'python.*?["\']([>=<~!]+\s*[\d.]+)', content)
        if match:
            result.python_version = match.group(1)

    # Scan each Python file for AI frameworks
    detected_frameworks = set()
    ai_files_set = set()

    # Files to skip (training scripts, this tool, tests, configs)
    skip_patterns = ['train_', 'benchmark_', 'galtea_deploy', 'test_', 'setup.py', 'conftest', '__pycache__']

    for py_file in py_files:
        # Skip irrelevant files
        if any(pat in py_file.name for pat in skip_patterns):
            continue
        if any(pat in str(py_file) for pat in ['__pycache__', '.egg', 'node_modules', 'venv', '.venv']):
            continue

        try:
            content = py_file.read_text(errors='ignore')
        except Exception:
            continue

        # Skip files that are clearly ML training (not agent code)
        if 'torch.optim' in content or 'model.train()' in content or 'DataLoader' in content:
            continue

        file_frameworks = set()
        file_agent_types = set()
        file_models = set()

        # Detect frameworks — require at least one IMPORT match (not just markers)
        for framework, patterns in FRAMEWORK_PATTERNS.items():
            has_import = any(re.search(p, content) for p in patterns['imports'])
            if not has_import:
                continue
            has_marker = any(re.search(p, content) for p in patterns['markers'])
            if has_import and has_marker:
                file_frameworks.add(framework)
                detected_frameworks.add(framework)
                ai_files_set.add(str(py_file))

        if not file_frameworks:
            continue

        # Detect agent types
        for agent_type, patterns in AGENT_TYPE_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, content):
                    file_agent_types.add(agent_type)

        # Detect model providers
        for provider, patterns in MODEL_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, content):
                    file_models.add(provider)

        # Extract entry points (classes and main functions)
        classes = [c for c in re.findall(r'class\s+([A-Z]\w{2,})', content) if len(c) > 3]
        functions = re.findall(r'def\s+((?:run|main|chat|query|invoke|execute|process|generate)[_a-zA-Z]\w{2,})', content)
        entry_points = classes + functions

        for ep in entry_points[:3]:  # Max 3 per file
            agent = AgentDetection(
                name=ep,
                framework=list(file_frameworks)[0],
                file_path=str(py_file.relative_to(repo)),
                entry_point=ep,
                agent_type=list(file_agent_types)[0] if file_agent_types else 'chain',
                model_provider=list(file_models)[0] if file_models else 'openai',
                confidence=min(0.95, 0.5 + 0.1 * len(file_frameworks) + 0.1 * len(file_agent_types)),
            )
            result.agents.append(agent)

    result.frameworks = list(detected_frameworks)
    result.ai_files = len(ai_files_set)

    # Print summary
    print(f"[SCAN] AI-related files: {result.ai_files}")
    print(f"[SCAN] Frameworks detected: {', '.join(result.frameworks) or 'none'}")
    print(f"[SCAN] Agents/pipelines found: {len(result.agents)}")
    print(f"[SCAN] Has tests: {'Yes' if result.has_tests else 'No'}")
    print(f"[SCAN] Has CI/CD: {'Yes' if result.has_ci else 'No'}")

    for i, agent in enumerate(result.agents[:10]):
        print(f"  [{i+1}] {agent.name} ({agent.framework}/{agent.agent_type}) in {agent.file_path}")

    return result


# ── Phase 2: INSTRUMENT ──────────────────────────────────────────────────────

def generate_integration_code(scan: ScanResult, api_key: str = "YOUR_API_KEY") -> Dict[str, str]:
    """Phase 2: Generate Galtea SDK integration code for each detected agent."""
    print(f"\n{'='*60}")
    print(f"  GALTEA DEPLOY AGENT — Phase 2: INSTRUMENT")
    print(f"{'='*60}\n")

    files = {}

    # 1. Generate galtea_config.py
    files['galtea_config.py'] = f'''"""Galtea evaluation configuration — auto-generated by Deploy Agent."""
import os
from galtea import Galtea

# Initialize Galtea client
galtea = Galtea(api_key=os.environ.get("GALTEA_API_KEY", "{api_key}"))

# Product configuration
PRODUCT_NAME = "{Path(scan.repo_path).name}"
PRODUCT_DESCRIPTION = "AI product with {len(scan.agents)} detected agents using {', '.join(scan.frameworks)}"

# Detected agents for evaluation
AGENTS = {json.dumps([{"name": a.name, "type": a.agent_type, "framework": a.framework, "file": a.file_path} for a in scan.agents[:20]], indent=2)}
'''

    # 2. Generate specifications per agent type
    specs = set(a.agent_type for a in scan.agents)
    spec_code = '''"""Galtea specifications — auto-generated by Deploy Agent."""
from galtea_config import galtea, PRODUCT_NAME

def create_product_and_specs():
    """Create the product and its specifications in Galtea."""
    # Create or get product
    product = galtea.products.create(name=PRODUCT_NAME)
    print(f"Product created: {product.id}")

    # Define specifications based on detected agent types
    specifications = []
'''

    spec_templates = {
        'rag': [
            ("Retrieval Accuracy", "The system retrieves relevant documents for the given query"),
            ("Answer Grounding", "Answers are grounded in retrieved context, not hallucinated"),
            ("Source Attribution", "The system cites sources when answering from retrieved documents"),
        ],
        'conversational': [
            ("Context Retention", "The system maintains conversation context across turns"),
            ("Response Coherence", "Responses are coherent and relevant to the conversation"),
            ("Persona Consistency", "The system maintains consistent behavior throughout the session"),
        ],
        'tool-calling': [
            ("Tool Selection", "The system selects the appropriate tool for the given task"),
            ("Parameter Accuracy", "Tool calls include correct and complete parameters"),
            ("Error Handling", "The system gracefully handles tool execution failures"),
        ],
        'chain': [
            ("Step Accuracy", "Each step in the chain produces correct intermediate results"),
            ("End-to-End Quality", "The final output meets quality expectations"),
            ("Latency Budget", "The chain completes within acceptable time limits"),
        ],
        'multi-agent': [
            ("Agent Coordination", "Agents coordinate effectively to complete tasks"),
            ("Role Adherence", "Each agent stays within its defined role and capabilities"),
            ("Conflict Resolution", "The system resolves conflicting agent outputs appropriately"),
        ],
    }

    for agent_type in specs:
        templates = spec_templates.get(agent_type, spec_templates['chain'])
        for name, description in templates:
            spec_code += f'''
    spec = galtea.specifications.create(
        product_id=product.id,
        name="{name}",
        description="{description}",
    )
    specifications.append(spec)
    print(f"  Spec: {{spec.name}}")
'''

    spec_code += '''
    return product, specifications

if __name__ == "__main__":
    create_product_and_specs()
'''
    files['galtea_specs.py'] = spec_code

    # 3. Generate evaluation runner
    eval_code = '''"""Galtea evaluation runner — auto-generated by Deploy Agent."""
import asyncio
from galtea_config import galtea, PRODUCT_NAME, AGENTS

async def run_evaluation(agent_callable, test_inputs: list[dict], version_name: str = "v1"):
    """Run a Galtea evaluation against an agent.

    Args:
        agent_callable: A function that takes a string input and returns a string output
        test_inputs: List of dicts with 'input' and optionally 'expected_output' keys
        version_name: Version identifier for this evaluation run
    """
    # Get or create product
    product = galtea.products.get_by_name(PRODUCT_NAME)

    # Create version
    version = galtea.versions.create(product_id=product.id, name=version_name)
    print(f"Evaluation version: {version.name}")

    # Create session and run inference
    session = galtea.sessions.create(product_id=product.id, version_id=version.id)

    results = []
    for i, test in enumerate(test_inputs):
        user_input = test['input']
        expected = test.get('expected_output', '')

        # Run the agent
        try:
            agent_output = agent_callable(user_input)
        except Exception as e:
            agent_output = f"ERROR: {e}"

        # Record inference result
        result = galtea.inference_results.create_and_evaluate(
            session_id=session.id,
            input=user_input,
            output=agent_output,
            expected_output=expected,
        )
        results.append(result)
        print(f"  [{i+1}/{len(test_inputs)}] Input: {user_input[:50]}... => Score: {getattr(result, 'score', 'N/A')}")

    # Run full evaluation
    evaluation = galtea.evaluations.create(session_id=session.id)
    galtea.evaluations.wait(evaluation_id=evaluation.id)

    print(f"\\nEvaluation complete: {evaluation.id}")
    print(f"Dashboard: https://app.galtea.ai/products/{product.id}/evaluations/{evaluation.id}")

    return evaluation


# Example usage with detected agents
SAMPLE_TESTS = [
    {"input": "What is your main capability?", "expected_output": ""},
    {"input": "Explain how you handle errors", "expected_output": ""},
    {"input": "What are your limitations?", "expected_output": ""},
    {"input": "Process this request: summarize the latest updates", "expected_output": ""},
    {"input": "What security measures do you implement?", "expected_output": ""},
]


def wrap_agent(agent_module_path: str, entry_point: str):
    """Dynamically import and wrap a client's agent for evaluation."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("agent_module", agent_module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    agent_class_or_func = getattr(module, entry_point)

    if callable(agent_class_or_func) and isinstance(agent_class_or_func, type):
        # It's a class — instantiate and look for common methods
        instance = agent_class_or_func()
        for method_name in ['run', 'invoke', 'chat', 'query', 'execute', 'process', '__call__']:
            if hasattr(instance, method_name):
                return getattr(instance, method_name)
        raise ValueError(f"Could not find a callable method on {entry_point}")
    else:
        return agent_class_or_func


if __name__ == "__main__":
    # Demo: evaluate with a simple echo agent
    def demo_agent(input_text: str) -> str:
        return f"I received your message: {input_text}"

    asyncio.run(run_evaluation(demo_agent, SAMPLE_TESTS))
'''
    files['galtea_eval.py'] = eval_code

    # 4. Generate CI/CD integration
    ci_code = '''# Galtea Evaluation — GitHub Actions workflow
# Auto-generated by Deploy Agent

name: AI Evaluation (Galtea)

on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install galtea
          pip install -r requirements.txt

      - name: Run Galtea Evaluation
        env:
          GALTEA_API_KEY: ${{ secrets.GALTEA_API_KEY }}
        run: python galtea_eval.py

      - name: Comment PR with results
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: '## Galtea AI Evaluation\\n\\nEvaluation completed. View results at https://app.galtea.ai'
            })
'''
    files['.github/workflows/galtea-eval.yml'] = ci_code

    # 5. Generate requirements addition
    files['requirements-galtea.txt'] = 'galtea>=0.1.0\n'

    # Print summary
    print(f"[INSTRUMENT] Generated {len(files)} files:")
    for f in files:
        print(f"  + {f}")

    return files


# ── Phase 3: TEST ─────────────────────────────────────────────────────────────

def run_sample_evaluation(scan: ScanResult, api_key: str) -> Dict:
    """Phase 3: Run a sample evaluation to verify the integration works."""
    print(f"\n{'='*60}")
    print(f"  GALTEA DEPLOY AGENT — Phase 3: TEST")
    print(f"{'='*60}\n")

    try:
        from galtea import Galtea
        client = Galtea(api_key=api_key)

        # Create product
        product_name = f"deploy-agent-{Path(scan.repo_path).name}"
        product = client.products.create(name=product_name)
        print(f"[TEST] Product created: {product_name}")

        # Create a basic spec
        spec = client.specifications.create(
            product_id=product.id,
            name="Basic Response Quality",
            description="The agent provides relevant and helpful responses",
        )
        print(f"[TEST] Specification created: {spec.name}")

        # Create version and session
        version = client.versions.create(product_id=product.id, name="deploy-agent-test")
        session = client.sessions.create(product_id=product.id, version_id=version.id)

        # Run a simple test
        result = client.inference_results.create_and_evaluate(
            session_id=session.id,
            input="Hello, what can you do?",
            output="I am an AI assistant that can help with various tasks.",
            expected_output="A helpful response describing capabilities",
        )
        print(f"[TEST] Inference result: {result.id}")

        # Run evaluation
        evaluation = client.evaluations.create(session_id=session.id)
        client.evaluations.wait(evaluation_id=evaluation.id)
        print(f"[TEST] Evaluation complete: {evaluation.id}")

        return {
            "status": "success",
            "product_id": product.id,
            "evaluation_id": evaluation.id,
            "dashboard_url": f"https://app.galtea.ai/products/{product.id}",
        }

    except ImportError:
        print("[TEST] Galtea SDK not installed. Run: pip install galtea")
        return {"status": "skipped", "reason": "SDK not installed"}
    except Exception as e:
        print(f"[TEST] Error: {e}")
        return {"status": "error", "error": str(e)}


# ── Phase 4: REPORT ──────────────────────────────────────────────────────────

def generate_report(scan: ScanResult, test_result: Dict, files: Dict) -> str:
    """Phase 4: Generate a deployment report."""
    print(f"\n{'='*60}")
    print(f"  GALTEA DEPLOY AGENT — Phase 4: REPORT")
    print(f"{'='*60}\n")

    report = f"""# Galtea Deployment Report
## Client: {Path(scan.repo_path).name}
## Date: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}

---

### 1. Repository Analysis

| Metric | Value |
|--------|-------|
| Python files | {scan.total_py_files} |
| AI-related files | {scan.ai_files} |
| Frameworks | {', '.join(scan.frameworks) or 'None detected'} |
| Agents detected | {len(scan.agents)} |
| Existing tests | {'Yes' if scan.has_tests else 'No'} |
| CI/CD pipeline | {'Yes' if scan.has_ci else 'No'} |

### 2. Detected AI Agents

| # | Name | Framework | Type | Model | File |
|---|------|-----------|------|-------|------|
"""
    for i, a in enumerate(scan.agents[:20]):
        report += f"| {i+1} | {a.name} | {a.framework} | {a.agent_type} | {a.model_provider} | `{a.file_path}` |\n"

    report += f"""
### 3. Generated Integration Files

| File | Purpose |
|------|---------|
| `galtea_config.py` | SDK initialization and agent configuration |
| `galtea_specs.py` | Behavioral specifications per agent type |
| `galtea_eval.py` | Evaluation runner with agent wrapper |
| `.github/workflows/galtea-eval.yml` | CI/CD pipeline integration |
| `requirements-galtea.txt` | Galtea SDK dependency |

### 4. Test Results

- Status: **{test_result.get('status', 'N/A')}**
- Dashboard: {test_result.get('dashboard_url', 'N/A')}

### 5. Recommended Next Steps

1. Add `GALTEA_API_KEY` to repository secrets
2. Review and customize specifications in `galtea_specs.py`
3. Connect each agent's entry point in `galtea_eval.py`
4. Run first full evaluation: `python galtea_eval.py`
5. Merge the CI/CD workflow to automate evaluations on every PR

### 6. Estimated Onboarding Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Repository scan | Automated | Done |
| SDK integration | Automated | Done |
| Specification review | 30 min (with client) | Pending |
| First evaluation run | 5 min | {'Done' if test_result.get('status') == 'success' else 'Pending'} |
| CI/CD activation | 10 min | Pending |
| **Total onboarding** | **~1 hour** | |

---

*Generated by Galtea Deploy Agent v1.0*
*Contact: support@galtea.ai*
"""

    report_path = Path(scan.repo_path) / "GALTEA_DEPLOYMENT_REPORT.md"
    report_path.write_text(report)
    print(f"[REPORT] Saved to: {report_path}")

    return report


# ── Phase 5: PR (optional) ───────────────────────────────────────────────────

def create_pull_request(scan: ScanResult, files: Dict, report: str):
    """Phase 5: Create a PR with the integration (optional, requires git)."""
    print(f"\n{'='*60}")
    print(f"  GALTEA DEPLOY AGENT — Phase 5: PR")
    print(f"{'='*60}\n")

    repo = Path(scan.repo_path)

    # Write all generated files
    for filepath, content in files.items():
        full_path = repo / filepath
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content)
        print(f"[PR] Wrote: {filepath}")

    # Check if it's a git repo
    if not (repo / ".git").exists():
        print("[PR] Not a git repo. Files written but no PR created.")
        return

    try:
        branch_name = "galtea/integration"
        subprocess.run(["git", "checkout", "-b", branch_name], cwd=repo, capture_output=True)
        subprocess.run(["git", "add", "."], cwd=repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "feat: add Galtea AI evaluation integration\n\nAuto-generated by Galtea Deploy Agent"],
            cwd=repo, capture_output=True
        )
        print(f"[PR] Branch created: {branch_name}")
        print(f"[PR] To push: git push -u origin {branch_name}")
        print(f"[PR] Then open a PR on GitHub/GitLab")
    except Exception as e:
        print(f"[PR] Git operations failed: {e}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Galtea Deploy Agent — Automated Enterprise AI Onboarding",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Scan a local repo
    python galtea_deploy_agent.py --repo ./my-ai-project

    # Full deployment with API key
    python galtea_deploy_agent.py --repo ./my-ai-project --api-key glt_xxx --full

    # Scan only (no API calls)
    python galtea_deploy_agent.py --repo ./my-ai-project --scan-only
        """,
    )
    parser.add_argument("--repo", required=True, help="Path to client's AI repository")
    parser.add_argument("--api-key", default=os.environ.get("GALTEA_API_KEY", ""), help="Galtea API key")
    parser.add_argument("--scan-only", action="store_true", help="Only scan, don't generate code")
    parser.add_argument("--full", action="store_true", help="Full deployment (scan + instrument + test + report + PR)")
    parser.add_argument("--output", default=None, help="Output directory for generated files")

    args = parser.parse_args()

    # Phase 1: SCAN
    scan = scan_repository(args.repo)

    if args.scan_only:
        print("\n[DONE] Scan complete. Use --full to generate integration code.")
        return

    if not scan.agents:
        print("\n[WARN] No AI agents detected. The repository may not contain recognizable AI frameworks.")
        print("Supported: LangChain, LlamaIndex, CrewAI, OpenAI, Anthropic, AutoGen, Haystack")
        return

    # Phase 2: INSTRUMENT
    files = generate_integration_code(scan, args.api_key or "YOUR_API_KEY")

    # Phase 3: TEST (only if API key provided)
    if args.api_key and args.full:
        test_result = run_sample_evaluation(scan, args.api_key)
    else:
        test_result = {"status": "skipped", "reason": "No API key or --full not specified"}

    # Phase 4: REPORT
    report = generate_report(scan, test_result, files)

    # Phase 5: PR (only if --full)
    if args.full:
        create_pull_request(scan, files, report)

    print(f"\n{'='*60}")
    print(f"  DEPLOYMENT COMPLETE")
    print(f"  Agents detected: {len(scan.agents)}")
    print(f"  Files generated: {len(files)}")
    print(f"  Test status: {test_result.get('status', 'N/A')}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
