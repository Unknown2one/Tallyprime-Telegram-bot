# Tally & WhatsApp MCP Tools Reference

This file lists all the available Model Context Protocol (MCP) tools in the system, along with their descriptions and input parameters. The chatbot evaluates this list to select the correct tool for any query.

### 1. `metadata-collection`
**Description:** returns collections metadata with collection and description

**Parameters:** None

---

### 2. `metadata-fields`
**Description:** returns fields metadata for the selected tally collection containing field name, optional description and data type which can be string, number, date or boolean

**Parameters:**
- `collection`* (string): target collection to fetch field metadata

---

### 3. `query-option-values`
**Description:** returns predefined option values or drop-down values for the fields required for master and voucher creation, it returns back object array of pre-defined values

**Parameters:**
- `optionName`* (string): option name to query

---

### 4. `query-database`
**Description:** executes sql query on pglite postgres in-memory database for querying cached Tally Prime report data in table generated as output by other tools (in tableID property from tool output response). These tables are temporary and will be dropped after 15 minutes automatically. Use this tool to run complex analytical queries to aggregate, filter, sort results

**Parameters:**
- `sql`* (string): SQL query to execute on pglite postgres in-memory database, only SELECT queries are allowed. UPDATE, DELETE, INSERT queries are not allowed for data safety
- `outputFormat` (string): optional output format, default is JSON Array of Objects. JSON Array of Objects = [{"column1": "value1", "column2": "value2"}, {...}] , JSON with Schema and Rows = {"schema": ["column1", "column2"], "rows": [["value1", "value2"], [...]]}, CSV = comma separated values with header, Markdown Table = table format with header in markdown syntax which can be directly rendered in markdown supported viewers

---

### 5. `query-collection`
**Description:** queries a Tally Prime collection with selected fields and optional context like target company and reporting period. result is cached in pglite postgres in-memory table and returned as tableID. Use query-database tool to run SQL queries against that table for further analysis

**Parameters:**
- `collection`* (string): collection name to query, validate it using metadata-collection tool with exact collection name
- `fields`* (array): list of field names to fetch for the selected collection. validate it using metadata-fields resource for that collection
- `targetCompany` (string): optional company name. leave it blank or skip this to choose default company. validate it using list-master tool with collection as company if specified
- `fromDate` (string): optional from date
- `toDate` (string): optional to date

---

### 6. `list-master`
**Description:** fetches list of masters from Tally Prime collection e.g. group, ledger, vouchertype, unit, godown, stockgroup, stockitem, costcategory, costcentre, attendancetype, company, currency, gstin, gstclassification returns output in JSON string array in the property list

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified
- `collection`* (string): 
- `containsFilter` (string): optional filter to apply on name field with contains operator to filter results with respective name value or keywords, case insensitive

---

### 7. `chart-of-accounts`
**Description:** fetches chart of accounts or GL hierarchy with fields ledger_name, group_name, primary_group, bs_pl, dr_cr, affects_gross_profit, sort_position. the column bs_pl will have values false = Balance Sheet / true = Profit Loss. Column dr_cr as value true = Debit / false = Credit. primary_group is the primary group of parent or group, under which ledger is nested. The columns group and parent are tree structure represented in flat format. The column affects_gross_profit has values true / false, it is used to determine if ledger under this group will affect gross profit or not. sort_position determines position or placement order with respect to items of same level for display, returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified

---

### 8. `trial-balance`
**Description:** fetches trial balance with fields ledger_name, group_name (blank if Profit & Loss), opening_balance, net_debit, net_credit, closing_balance. opening_balance and closing_balance negative is debit and positive is credit. kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified
- `fromDate`* (string): from or start date
- `toDate`* (string): to or end date
- `group_name` (string): optional group name to filter trial balance results, validate it using list-master tool with collection as group if required

---

### 9. `profit-loss`
**Description:** fetches profit and loss statement with fields like ledger_name, group_name, closing_balance. closing_balance negative is debit or expense and positive is credit or income. closing stock to be treated as credit, kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. for detailed ledger level analysis call trial-balance tool, returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified
- `fromDate`* (string): from or start date
- `toDate`* (string): to or end date

---

### 10. `balance-sheet`
**Description:** fetches balance sheet with fields like ledger_name, group_name (blank if Profit & Loss A/c), closing_balance. closing balance negative is debit or asset and positive is credit or liability. kindly fetch data from chart-of-accounts tool to pull group hierarchy before calling this tool. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified
- `fromDate`* (string): period start or from date
- `toDate`* (string): period end or to date

---

### 11. `stock-summary`
**Description:** fetches stock item summary with fields stock_item_name, stock_group_name, opening_quantity, opening_value, inward_quantity, inward_value, outward_quantity, outward_value, closing_quantity, closing_value, returns output cached in pglite postgres in-memory table (specified in tableID property). synonyms (name=stock item / parent=stock group) Use query-database tool to run SQL queries against that table for further analysis

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified
- `fromDate`* (string): period start or from date
- `toDate`* (string): period end or to date
- `stockGroup` (string): optional stock group name to filter stock summary results, validate it using list-master tool with collection as stock group if required

---

### 12. `ledger-balance`
**Description:** fetches ledger closing balance as on date, negative is debit and positive is credit, display Dr for Debit or Cr for Credit after the amount for better readability, instead of negative amount flip Debit or Credit to make it positive

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified
- `ledgerName`* (string): precise ledger name, always validate it using list-master tool with collection as ledger
- `toDate` (string): as on date for which balance is required (defaults to current date if not provided)

---

### 13. `stock-item-balance`
**Description:** fetches stock item remaining quantity balance as on date, tool returns quantity and unit of measurement

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified
- `itemName`* (string): precise stock item name, always validate it using list-master tool with collection as stockitem
- `toDate`* (string): as on date for which balance is required

---

### 14. `bills-outstanding`
**Description:** fetches pending overdue outstanding bills receivable or payable as on date with fields bill_date,reference_number,outstanding_amount,party_name,overdue_days. outstanding_amount = Debit is negative and Credit is positive. party_name = ledger_name. returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified
- `nature`* (string): 
- `toDate` (string): as on date (defaults to current date if not provided)

---

### 15. `ledger-account`
**Description:** fetches GL ledger account statement with voucher level details containing fields guid, date, voucher_type, voucher_number, alternate_ledger, party_name, amount, narration . amount = debit is negative and credit is positive. alternate_ledger = if amount is credit then ledger by which it is debited and vice-a-versa (in case of multiple ledgers first one is displayed). returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified
- `ledgerName`* (string): ledger name, always verify if ledger exists using list-master tool with collection as ledger
- `fromDate`* (string): from or start date
- `toDate`* (string): to or end date

---

### 16. `stock-item-account`
**Description:** fetches GL stock item account statement with voucher level details containing fields date, voucher_type, voucher_number, party_name, quantity, amount, narration, tracking_number, voucher_category. party_name = ledger_name. quantity = inward as positive and outward as negative. amount = debit is negative and credit is positive, narration = notes / remarks. for calculating closing balance of quantity, consider rows with tracking_number as empty as it is, but for rows with tracking_number having text value, then duplicate rows need to be removed by preparing intermediate output with aggregation of tracking_number and voucher_category with sum of quantity and then comparing quantity of Receipt Note with Purchase and Delivery Note with Sales to identify and remove the rows with Receipt Note and Delivery Note if they are found to be tracked fully / partially . returns output cached in pglite postgres in-memory table (specified in tableID property). Use query-database tool to run SQL queries against that table for further analysis

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified
- `itemName`* (string): stock item name, validate it using list-master tool with collection as stockitem
- `fromDate`* (string): from or start date
- `toDate`* (string): to or end date

---

### 17. `ledger-create-update`
**Description:** create or update ledger master data in Tally Prime, returns success count of created and / or altered records

**Parameters:**
- `targetCompany` (string): optional company name. leave it blank or skip this to choose for default company. validate it using list-master tool with collection as company if specified
- `masters`* (array): array of master data objects to create or update

---

### 18. `set-company`
**Description:** sets the active company context in Tally Prime. This changes the global company context used by Tally for subsequent operations and report queries

**Parameters:**
- `companyName`* (string): company name to set as active, validate it using list-master tool with collection as company

---

### 19. `set-period`
**Description:** sets the active reporting period in Tally Prime by specifying a from date and to date. This changes the global period context used by Tally for subsequent report queries

**Parameters:**
- `fromDate`* (string): start date of the period
- `toDate`* (string): end date of the period

---

### 20. `pipeline-outstanding-balance`
**Description:** Instantly fetches the total outstanding balance for a given ledger name (case-insensitive) across all bills. Avoids multiple MCP calls.

**Parameters:**
- `ledgerName`* (string): The name of the ledger (e.g. Vansh Textile). Partial match is allowed.
- `nature`* (string): Receivable (Debtors) or Payable (Creditors)
- `toDate` (string): As on date (defaults to current date if not provided)

---

### 21. `pipeline-ledger-statement`
**Description:** Generates a PDF ledger statement in a single call. Resolves the exact ledger name, fetches balances and transactions, and generates the PDF natively.

**Parameters:**
- `ledgerName`* (string): The name of the ledger (e.g. Vansh Textile)
- `fromDate`* (string): 
- `toDate`* (string): 

---

### 22. `search-ledgers`
**Description:** Search for Tally ledgers by a partial name to get their precise Tally name. Always use this before creating vouchers to avoid precise-name exceptions.

**Parameters:**
- `targetCompany` (string): optional company name
- `query`* (string): partial name of the ledger to search for

---

### 23. `create-voucher`
**Description:** Creates a voucher in Tally (e.g. Receipt, Receipt Book, Payment, Sales) using Tally XML Import. Amount must be positive. debitLedger and creditLedger must be precise Tally names.

**Parameters:**
- `voucherType`* (string): Voucher Type (e.g., Receipt, Payment, Receipt Book)
- `date`* (string): Date in YYYYMMDD format
- `creditLedger`* (string): Precise name of the ledger being credited (giving money)
- `debitLedger`* (string): Precise name of the ledger being debited (receiving money)
- `amount`* (number): Amount of the transaction (positive)
- `narration` (string): Voucher narration
- `discountLedger` (string): Optional name of the discount ledger (e.g. Discount Allowed)
- `discountAmount` (number): Optional discount amount (positive)
- `voucherNumber` (string): Optional voucher number

---

### 24. `search_contacts`
**Description:** Search WhatsApp contacts by name or phone number.
    
    Args:
        query: Search term to match against contact names or phone numbers
    

**Parameters:**
- `query`* (string): 

---

### 25. `list_messages`
**Description:** Get WhatsApp messages matching specified criteria with optional context.
    
    Args:
        after: Optional ISO-8601 formatted string to only return messages after this date
        before: Optional ISO-8601 formatted string to only return messages before this date
        sender_phone_number: Optional phone number to filter messages by sender
        chat_jid: Optional chat JID to filter messages by chat
        query: Optional search term to filter messages by content
        limit: Maximum number of messages to return (default 20)
        page: Page number for pagination (default 0)
        include_context: Whether to include messages before and after matches (default True)
        context_before: Number of messages to include before each match (default 1)
        context_after: Number of messages to include after each match (default 1)
    

**Parameters:**
- `after` (string): 
- `before` (string): 
- `sender_phone_number` (string): 
- `chat_jid` (string): 
- `query` (string): 
- `limit` (integer): 
- `page` (integer): 
- `include_context` (boolean): 
- `context_before` (integer): 
- `context_after` (integer): 

---

### 26. `list_chats`
**Description:** Get WhatsApp chats matching specified criteria.
    
    Args:
        query: Optional search term to filter chats by name or JID
        limit: Maximum number of chats to return (default 20)
        page: Page number for pagination (default 0)
        include_last_message: Whether to include the last message in each chat (default True)
        sort_by: Field to sort results by, either "last_active" or "name" (default "last_active")
    

**Parameters:**
- `query` (string): 
- `limit` (integer): 
- `page` (integer): 
- `include_last_message` (boolean): 
- `sort_by` (string): 

---

### 27. `get_chat`
**Description:** Get WhatsApp chat metadata by JID.
    
    Args:
        chat_jid: The JID of the chat to retrieve
        include_last_message: Whether to include the last message (default True)
    

**Parameters:**
- `chat_jid`* (string): 
- `include_last_message` (boolean): 

---

### 28. `get_direct_chat_by_contact`
**Description:** Get WhatsApp chat metadata by sender phone number.
    
    Args:
        sender_phone_number: The phone number to search for
    

**Parameters:**
- `sender_phone_number`* (string): 

---

### 29. `get_contact_chats`
**Description:** Get all WhatsApp chats involving the contact.
    
    Args:
        jid: The contact's JID to search for
        limit: Maximum number of chats to return (default 20)
        page: Page number for pagination (default 0)
    

**Parameters:**
- `jid`* (string): 
- `limit` (integer): 
- `page` (integer): 

---

### 30. `get_last_interaction`
**Description:** Get most recent WhatsApp message involving the contact.
    
    Args:
        jid: The JID of the contact to search for
    

**Parameters:**
- `jid`* (string): 

---

### 31. `get_message_context`
**Description:** Get context around a specific WhatsApp message.
    
    Args:
        message_id: The ID of the message to get context for
        before: Number of messages to include before the target message (default 5)
        after: Number of messages to include after the target message (default 5)
    

**Parameters:**
- `message_id`* (string): 
- `before` (integer): 
- `after` (integer): 

---

### 32. `send_message`
**Description:** Send a WhatsApp message to a person or group. For group chats use the JID.

    Args:
        recipient: The recipient - either a phone number with country code but no + or other symbols,
                 or a JID (e.g., "123456789@s.whatsapp.net" or a group JID like "123456789@g.us")
        message: The message text to send
    
    Returns:
        A dictionary containing success status and a status message
    

**Parameters:**
- `recipient`* (string): 
- `message`* (string): 

---

### 33. `send_file`
**Description:** Send a file such as a picture, raw audio, video or document via WhatsApp to the specified recipient. For group messages use the JID.
    
    Args:
        recipient: The recipient - either a phone number with country code but no + or other symbols,
                 or a JID (e.g., "123456789@s.whatsapp.net" or a group JID like "123456789@g.us")
        media_path: The absolute path to the media file to send (image, video, document)
        caption: Optional text caption to send along with the file
    
    Returns:
        A dictionary containing success status and a status message
    

**Parameters:**
- `recipient`* (string): 
- `media_path`* (string): 
- `caption` (string): 

---

### 34. `send_audio_message`
**Description:** Send any audio file as a WhatsApp audio message to the specified recipient. For group messages use the JID. If it errors due to ffmpeg not being installed, use send_file instead.
    
    Args:
        recipient: The recipient - either a phone number with country code but no + or other symbols,
                 or a JID (e.g., "123456789@s.whatsapp.net" or a group JID like "123456789@g.us")
        media_path: The absolute path to the audio file to send (will be converted to Opus .ogg if it's not a .ogg file)
    
    Returns:
        A dictionary containing success status and a status message
    

**Parameters:**
- `recipient`* (string): 
- `media_path`* (string): 

---

### 35. `download_media`
**Description:** Download media from a WhatsApp message and get the local file path.
    
    Args:
        message_id: The ID of the message containing the media
        chat_jid: The JID of the chat containing the message
    
    Returns:
        A dictionary containing success status, a status message, and the file path if successful
    

**Parameters:**
- `message_id`* (string): 
- `chat_jid`* (string): 

---

