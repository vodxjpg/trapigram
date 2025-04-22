export const tickets = [
    {
      id: "17554604-1bac-4b28-a34c-57295d21b9ba",
      title: "Cannot access my account",
      priority: "high" as const,
      status: "open" as const,
      createdAt: new Date("2023-04-15T10:30:00"),
      userName: "John Doe",
      telegramUsername: "johndoe",
      telegramUserId: 123456789,
      messages: [
        {
          sender: "user" as const,
          content: "I'm trying to log in but keep getting an error message. Can you help?",
          timestamp: new Date("2023-04-15T10:30:00"),
          attachments: [
            {
              name: "error_screenshot.png",
              url: "#",
              size: 245000,
            },
          ],
        },
      ],
    },
    {
      id: 2,
      title: "Feature request: dark mode",
      priority: "medium" as const,
      status: "in-progress" as const,
      createdAt: new Date("2023-04-14T15:45:00"),
      userName: "Jane Smith",
      telegramUsername: "janesmith",
      telegramUserId: 987654321,
      messages: [
        {
          sender: "user" as const,
          content:
            "Would it be possible to add a dark mode to the application? It would be much easier on the eyes when using it at night.",
          timestamp: new Date("2023-04-14T15:45:00"),
          attachments: [],
        },
        {
          sender: "admin" as const,
          content:
            "Thanks for the suggestion! We're actually working on implementing dark mode right now. It should be available in the next update.",
          timestamp: new Date("2023-04-14T16:20:00"),
          attachments: [],
        },
        {
          sender: "user" as const,
          content: "That's great news! Looking forward to it.",
          timestamp: new Date("2023-04-14T16:25:00"),
          attachments: [],
        },
      ],
    },
    {
      id: 3,
      title: "Billing question",
      priority: "low" as const,
      status: "closed" as const,
      createdAt: new Date("2023-04-13T09:15:00"),
      userName: "Robert Johnson",
      telegramUsername: "robjohnson",
      telegramUserId: 456789123,
      messages: [
        {
          sender: "user" as const,
          content: "I was charged twice for my subscription this month. Can you check this for me?",
          timestamp: new Date("2023-04-13T09:15:00"),
          attachments: [
            {
              name: "invoice_april.pdf",
              url: "#",
              size: 125000,
            },
          ],
        },
        {
          sender: "admin" as const,
          content:
            "I've checked your account and you're right - there was a duplicate charge. I've processed a refund for the extra payment, which should appear in your account within 3-5 business days.",
          timestamp: new Date("2023-04-13T10:05:00"),
          attachments: [
            {
              name: "refund_confirmation.pdf",
              url: "#",
              size: 98000,
            },
          ],
        },
        {
          sender: "user" as const,
          content: "Thank you for resolving this so quickly!",
          timestamp: new Date("2023-04-13T10:15:00"),
          attachments: [],
        },
      ],
    },
    {
      id: 4,
      title: "App crashes on startup",
      priority: "high" as const,
      status: "open" as const,
      createdAt: new Date("2023-04-16T14:20:00"),
      userName: "Emily Chen",
      telegramUsername: "emilyc",
      telegramUserId: 234567891,
      messages: [
        {
          sender: "user" as const,
          content:
            "After the latest update, the app crashes immediately when I try to open it. I've tried reinstalling but it didn't help.",
          timestamp: new Date("2023-04-16T14:20:00"),
          attachments: [],
        },
      ],
    },
    {
      id: 5,
      title: "How to export data?",
      priority: "medium" as const,
      status: "open" as const,
      createdAt: new Date("2023-04-16T11:05:00"),
      userName: "Michael Brown",
      telegramUsername: "mikebrown",
      telegramUserId: 345678912,
      messages: [
        {
          sender: "user" as const,
          content: "I need to export all my data for a report. Is there a way to do this in bulk?",
          timestamp: new Date("2023-04-16T11:05:00"),
          attachments: [],
        },
      ],
    },
  ]
  