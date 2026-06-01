fetch('http://localhost:3002/api/automation-logs')
  .then(res => res.json())
  .then(data => {
    console.log("Response:", JSON.stringify(data, null, 2));
  })
  .catch(err => {
    console.error("Error:", err);
  });
