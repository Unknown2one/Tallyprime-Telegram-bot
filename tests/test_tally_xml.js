const axios = require('axios');

async function testTally() {
    const xml = `
    <ENVELOPE>
        <HEADER>
            <TALLYREQUEST>Export Data</TALLYREQUEST>
        </HEADER>
        <BODY>
            <EXPORTDATA>
                <REQUESTDESC>
                    <REPORTNAME>List of Accounts</REPORTNAME>
                    <STATICVARIABLES>
                        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                        <ACCOUNTTYPE>Ledgers</ACCOUNTTYPE>
                    </STATICVARIABLES>
                </REQUESTDESC>
            </EXPORTDATA>
        </BODY>
    </ENVELOPE>`;

    try {
        const res = await axios.post('http://localhost:9000', xml, { headers: { 'Content-Type': 'text/xml' } });
        const data = res.data;
        const index = data.toLowerCase().indexOf('pawan cloth store');
        if (index !== -1) {
            const snippet = data.substring(Math.max(0, index - 500), index + 3500);
            if (snippet.toLowerCase().includes('phone') || snippet.toLowerCase().includes('mobile')) {
                const lines = snippet.split('\n');
                for (let line of lines) {
                    if (line.toLowerCase().includes('phone') || line.toLowerCase().includes('mobile')) {
                        console.log("MATCH:", line.trim());
                    }
                }
            } else {
                console.log("No phone or mobile found for pawan cloth store.");
            }
        }
    } catch(err) {
        console.error(err.message);
    }
}
testTally();
