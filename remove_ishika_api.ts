async function removeIshika() {
  const response = await fetch('http://localhost:3002/api/therapists');
  const therapists = await response.json();
  const ishika = therapists.find((t: any) => t.name.toLowerCase().includes('ishika mahajan'));
  
  if (ishika) {
    console.log('Found Ishika with ID:', ishika.therapist_id);
    const deleteRes = await fetch(`http://localhost:3002/api/therapists/${ishika.therapist_id}`, { method: 'DELETE' });
    const data = await deleteRes.json();
    console.log(data);
  } else {
    console.log('Ishika not found');
  }
}
removeIshika();
