class CostDashboard {
    constructor() {
        this.panel = document.getElementById('cost-panel');
        if (!this.panel) return;
        this.initDOM();
        this.fetchData();
        setInterval(() => this.fetchData(), 60000);

        this.expanded = false;
        this.panel.addEventListener('click', () => {
            this.expanded = !this.expanded;
            this.renderData(this.lastData);
        });
    }

    initDOM() {
        Object.assign(this.panel.style, {
            position: 'fixed',
            bottom: '12px',
            right: '12px',
            zIndex: '1050',
            width: '210px',
            background: 'linear-gradient(180deg, #08101dcc 0%, #020617ee 100%)',
            border: '1px solid #1e293b',
            borderRadius: '10px',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 16px #00000040',
            padding: '8px',
            color: '#f8fafc',
            fontFamily: "'Courier New', monospace",
            fontSize: '11px',
            cursor: 'pointer',
            transition: 'width 0.25s ease',
            pointerEvents: 'auto'
        });
        this.panel.innerHTML = `
            <div id="cost-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                <strong style="font-size:10px;color:#94a3b8;">COST HUD</strong>
                <span id="cost-status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: gray;"></span>
            </div>
            <div id="cost-budget-bar-container" style="width: 100%; height: 12px; background: #1e293b; border-radius: 2px; position: relative; overflow: hidden; margin-bottom: 5px;">
                <div id="cost-budget-bar" style="height: 100%; width: 0%; background: #22c55e; transition: width 0.3s;"></div>
                <div id="cost-budget-text" style="position: absolute; top: 0; left: 0; width: 100%; text-align: center; font-size: 9px; line-height: 12px; color: #fff;">$0.00 / $0.00</div>
            </div>
            <div id="cost-details" style="display: none; margin-top: 10px; border-top: 1px solid #334155; padding-top: 5px;"></div>
            <div id="cost-updated" style="font-size: 8px; color: #94a3b8; text-align: right; margin-top: 5px;"></div>
        `;
    }

    async fetchData() {
        try {
            const res = await fetch('cost-data.json');
            if (!res.ok) throw new Error('Failed to fetch cost data');
            const data = await res.json();
            this.lastData = data;
            this.renderData(data);
        } catch (err) {
            console.error('Cost Dashboard Error:', err);
        }
    }

    renderData(data) {
        if (!data) return;

        const { updated, total_cost, budget, status, models } = data;
        const pct = Math.min((total_cost / budget) * 100, 100);

        const bar = document.getElementById('cost-budget-bar');
        const barText = document.getElementById('cost-budget-text');
        const statusDot = document.getElementById('cost-status-dot');
        const details = document.getElementById('cost-details');
        const updatedDiv = document.getElementById('cost-updated');

        bar.style.width = pct + '%';
        if (pct < 60) bar.style.background = '#22c55e';
        else if (pct < 80) bar.style.background = '#eab308';
        else bar.style.background = '#ef4444';

        barText.textContent = '$' + total_cost.toFixed(2) + ' / $' + budget.toFixed(2);

        if (status === 'ok') statusDot.style.background = '#22c55e';
        else if (status === 'warning') statusDot.style.background = '#eab308';
        else statusDot.style.background = '#ef4444';

        updatedDiv.textContent = 'Upd: ' + updated;

        if (this.expanded) {
            this.panel.style.width = '250px';
            details.style.display = 'block';

            let html = '';
            for (const m of (models || [])) {
                let color = '#94a3b8';
                if (m.model.includes('pro')) color = '#3b82f6';
                else if (m.model.includes('flash-lite')) color = '#eab308';
                else if (m.model.includes('qwen')) color = '#22c55e';
                else if (m.model.includes('gpt')) color = '#a855f7';

                const modelName = m.model.split('/').pop().replace('gemini-', '');
                html += '<div style="display:flex;justify-content:space-between;margin-bottom:2px;">';
                html += '<span style="color:' + color + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;">' + modelName + '</span>';
                html += '<span>$' + m.cost.toFixed(2) + '</span></div>';
            }
            details.innerHTML = html;
        } else {
            this.panel.style.width = '200px';
            details.style.display = 'none';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new CostDashboard();
});
